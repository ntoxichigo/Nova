import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Telegram webhook receiver.
 * Register with: POST https://api.telegram.org/bot{TOKEN}/setWebhook
 *   { url: "https://yourdomain.com/api/telegram/webhook", secret_token: "...", allowed_updates: ["message"] }
 */
export async function POST(request: NextRequest) {
  // Validate Telegram's secret token header
  const secret = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  const storedSecret = await db.settings.findUnique({ where: { key: 'telegram_webhook_secret' } });
  if (!storedSecret?.value || secret !== storedSecret.value) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  let update: Record<string, unknown>;
  try {
    update = await request.json();
  } catch {
    return new NextResponse('Bad Request', { status: 400 });
  }

  type TgMessage = { chat: { id: number }; text?: string };
  const msg = (update.message ?? update.edited_message) as TgMessage | undefined;
  if (!msg?.chat?.id) return NextResponse.json({ ok: true });

  const chatId = String(msg.chat.id);
  const text = (msg.text ?? '').trim();

  const botToken = (await db.settings.findUnique({ where: { key: 'telegram_bot_token' } }))?.value ?? '';
  if (!botToken) return NextResponse.json({ ok: true });

  // Handle /start command
  if (!text || text === '/start') {
    if (text === '/start') {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: "👋 Hi! I'm your Nova AI assistant. Send me any message to get started." }),
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  }

  // Show typing indicator (fire and forget)
  fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
  }).catch(() => {});

  // Find or create a conversation scoped to this Telegram chat ID
  let conv = await db.conversation.findFirst({
    where: { title: { startsWith: `tg:${chatId}:` } },
    orderBy: { createdAt: 'desc' },
  });
  if (!conv) {
    conv = await db.conversation.create({
      data: { title: `tg:${chatId}:${text.slice(0, 30)}` },
    });
  }

  // Call internal chat/stream endpoint and collect the full response
  const baseUrl = (process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  let reply = '';

  try {
    const streamRes = await fetch(`${baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, conversationId: conv.id }),
      signal: AbortSignal.timeout(120_000), // 2 min max
    });

    if (!streamRes.body) throw new Error('No response body from chat stream');

    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value, { stream: true }).split('\n');
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        try {
          const evt = JSON.parse(line.slice(5).trim()) as { type: string; content?: string };
          if (evt.type === 'chunk') reply += evt.content ?? '';
          if (evt.type === 'replace') reply = evt.content ?? ''; // tool result replaces draft
        } catch { /* skip malformed */ }
      }
    }
  } catch (err) {
    reply = `⚠️ ${err instanceof Error ? err.message : 'An error occurred. Please try again.'}`;
  }

  if (!reply.trim()) return NextResponse.json({ ok: true });

  // Telegram has a 4096-char per-message limit; split if needed
  const chunks: string[] = [];
  let remaining = reply.slice(0, 16384); // hard cap to avoid infinite loops
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, 4096));
    remaining = remaining.slice(4096);
  }

  for (const chunk of chunks) {
    const sent = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'Markdown' }),
    }).catch(() => null);

    // If Markdown parse fails, retry as plain text
    if (sent && !sent.ok) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
      }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true });
}
