import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tryRecordAuditEvent } from '@/lib/audit';

// POST /api/scheduled-tasks/run — execute a task & store result
export async function POST(request: NextRequest) {
  try {
    const { id } = (await request.json()) as { id?: string };
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const task = await db.scheduledTask.findUnique({ where: { id } });
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    // Determine base URL for internal API call
    const baseUrl = (
      process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    ).replace(/\/$/, '');

    // Create a temporary conversation for this task execution
    const conversation = await db.conversation.create({
      data: { title: `⏰ Task: ${task.name}` },
    });

    // Call the chat stream endpoint
    const res = await fetch(`${baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: task.prompt, conversationId: conversation.id }),
    });

    if (!res.ok || !res.body) {
      await db.scheduledTask.update({
        where: { id },
        data: { lastRunAt: new Date(), lastResult: `Error: HTTP ${res.status}` },
      });
      return NextResponse.json({ error: 'Stream failed' }, { status: 500 });
    }

    // Collect all SSE chunks into the response text
    const reader = res.body.getReader();
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

    // Save last result
    const truncated = resultText.slice(0, 2000);
    await db.scheduledTask.update({
      where: { id },
      data: { lastRunAt: new Date(), lastResult: truncated },
    });

    await tryRecordAuditEvent({
      source: 'automation',
      action: 'run_task',
      entityType: 'scheduled_task',
      entityId: task.id,
      entityLabel: task.name,
      summary: `Executed scheduled task "${task.name}"`,
      details: {
        channel: task.channel,
        conversationId: conversation.id,
        resultPreview: truncated.slice(0, 300),
      },
      conversationId: conversation.id,
    });

    // If channel is telegram, try to send it
    if (task.channel === 'telegram') {
      try {
        const botToken = (await db.settings.findUnique({ where: { key: 'telegram_bot_token' } }))?.value;
        const chatIdSetting = (await db.settings.findUnique({ where: { key: 'telegram_default_chat_id' } }))?.value;
        if (botToken && chatIdSetting) {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatIdSetting,
              text: `⏰ **${task.name}**\n\n${truncated}`,
              parse_mode: 'Markdown',
            }),
          });
        }
      } catch { /* best-effort */ }
    }

    return NextResponse.json({
      ok: true,
      result: truncated,
      conversationId: conversation.id,
    });
  } catch (e) {
    console.error('task run:', e);
    await tryRecordAuditEvent({
      source: 'automation',
      action: 'run_task',
      entityType: 'scheduled_task',
      entityLabel: 'unknown',
      status: 'error',
      severity: 'warning',
      summary: 'Scheduled task run failed',
      details: {
        error: e instanceof Error ? e.message : 'Unknown error',
      },
    });
    return NextResponse.json({ error: 'Run failed' }, { status: 500 });
  }
}
