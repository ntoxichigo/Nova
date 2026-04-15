import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createPublicKey, verify as cryptoVerify } from 'crypto';

// Verify Discord interaction signature (Ed25519)
function verifyDiscordRequest(publicKeyHex: string, signature: string, timestamp: string, rawBody: string): boolean {
  if (!publicKeyHex || !signature || !timestamp) return false;
  try {
    // Build SPKI DER: Ed25519 OID prefix (12 bytes) + 32-byte raw key
    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const keyBytes = Buffer.from(publicKeyHex, 'hex');
    if (keyBytes.length !== 32) return false;
    const derKey = Buffer.concat([spkiPrefix, keyBytes]);
    const pubKey = createPublicKey({ key: derKey, format: 'der', type: 'spki' });
    const message = Buffer.concat([Buffer.from(timestamp, 'utf8'), Buffer.from(rawBody, 'utf8')]);
    const sig = Buffer.from(signature, 'hex');
    return cryptoVerify('ed25519', message, pubKey, sig);
  } catch {
    return false;
  }
}

// POST /api/discord/webhook — receive Discord bot interactions
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const sig = request.headers.get('x-signature-ed25519') ?? '';
    const ts  = request.headers.get('x-signature-timestamp') ?? '';
    const discordPubKey = process.env.DISCORD_PUBLIC_KEY ?? '';

    // Verify signature when DISCORD_PUBLIC_KEY env var is configured
    if (discordPubKey) {
      if (!verifyDiscordRequest(discordPubKey, sig, ts, rawBody)) {
        return new NextResponse('Invalid request signature', { status: 401 });
      }
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new NextResponse('Bad Request', { status: 400 });
    }

    // Discord sends a ping to verify the endpoint
    // type 1 = PING
    if (body.type === 1) {
      return NextResponse.json({ type: 1 }); // PONG
    }

    // type 2 = APPLICATION_COMMAND (slash command)
    // type 3 = MESSAGE_COMPONENT
    // For a simple bot we handle type 2 and text from message content
    const data = body.data as { options?: Array<{ value?: string }>; name?: string } | undefined;
    const content = data?.options?.[0]?.value
      || (body.content as string | undefined)
      || data?.name
      || '';

    if (!content) {
      return NextResponse.json({
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
        data: { content: 'Please provide a message.' },
      });
    }

    const channelObj = body.channel as { id?: string } | undefined;
    const channelId = (body.channel_id as string | undefined) || channelObj?.id || 'unknown';
    const memberObj = body.member as { user?: { id?: string } } | undefined;
    const userObj   = body.user   as { id?: string } | undefined;
    const userId = memberObj?.user?.id || userObj?.id || 'unknown';

    // Determine base URL
    const baseUrl = (
      process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    ).replace(/\/$/, '');

    // Find or create conversation for this Discord channel
    const convTitle = `discord:${channelId}`;
    let conversation = await db.conversation.findFirst({
      where: { title: convTitle },
      orderBy: { createdAt: 'desc' },
    });
    if (!conversation) {
      conversation = await db.conversation.create({
        data: { title: convTitle },
      });
    }

    // Call chat stream API
    const streamRes = await fetch(`${baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: content,
        conversationId: conversation.id,
      }),
    });

    if (!streamRes.ok || !streamRes.body) {
      return NextResponse.json({
        type: 4,
        data: { content: 'Sorry, I encountered an error.' },
      });
    }

    // Collect response
    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let resultText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.replace(/^data:\s*/, '').trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          if (event.type === 'chunk') resultText += event.content;
          if (event.type === 'replace') resultText = event.content ?? '';
        } catch { /* ignore */ }
      }
    }

    // Discord message limit is 2000 chars
    const truncated = resultText.length > 1900
      ? resultText.slice(0, 1900) + '\n…(truncated)'
      : resultText || 'No response generated.';

    // For slash commands, return an interaction response
    if (body.type === 2) {
      return NextResponse.json({
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
        data: {
          content: truncated,
          flags: 0,
        },
      });
    }

    // For webhook-style (non-interaction) messages, just return the text
    return NextResponse.json({
      content: truncated,
      userId,
      channelId,
      conversationId: conversation.id,
    });
  } catch (e) {
    console.error('discord webhook:', e);
    return NextResponse.json({
      type: 4,
      data: { content: 'Internal error.' },
    }, { status: 500 });
  }
}
