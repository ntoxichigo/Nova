export interface ChatStreamEvent {
  type: string;
  [key: string]: unknown;
}

const STANDALONE_TOOL_LINE = /^(web[_-]?search|google[_-]?search|get_weather|get_time|lookup_wikipedia|read_webpage|create_memory|run_code)\s*$/i;

function stripStandaloneToolLines(content: string): string {
  const lines = content.split(/\r?\n/);
  const kept: string[] = [];
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      kept.push(line);
      continue;
    }

    if (!inFence && STANDALONE_TOOL_LINE.test(trimmed)) {
      continue;
    }

    kept.push(line);
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function sanitizeAssistantContent(content: string): string {
  const toolStart = content.indexOf('```tool');
  if (toolStart !== -1) {
    if (content.indexOf('```', toolStart + 7) === -1) {
      return content.slice(0, toolStart).trimEnd();
    }
    return stripStandaloneToolLines(content.replace(/```tool\s*[\s\S]*?```/g, '').trim());
  }

  const inlineStart = content.indexOf('{"name"');
  if (inlineStart !== -1 && content.indexOf('"arguments"', inlineStart) !== -1) {
    let depth = 0;
    let inStr = false;
    let end = -1;

    for (let i = inlineStart; i < content.length; i += 1) {
      const ch = content[i];
      if (inStr) {
        if (ch === '\\') {
          i += 1;
          continue;
        }
        if (ch === '"') inStr = false;
      } else {
        if (ch === '"') inStr = true;
        else if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
    }

    if (end === -1) {
      return content.slice(0, inlineStart).trimEnd();
    }

    return stripStandaloneToolLines((content.slice(0, inlineStart) + content.slice(end + 1)).trim());
  }

  return stripStandaloneToolLines(content);
}

async function emitEventLine(
  line: string,
  onEvent: (event: ChatStreamEvent) => void | Promise<void>,
): Promise<void> {
  const trimmed = line.replace(/^data:\s*/, '').trim();
  if (!trimmed || trimmed === '[DONE]') return;

  try {
    const event = JSON.parse(trimmed) as ChatStreamEvent;
    if (event && typeof event === 'object' && typeof event.type === 'string') {
      await onEvent(event);
    }
  } catch {
    // Ignore malformed stream fragments and keep reading subsequent events.
  }
}

export async function consumeJsonEventStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void | Promise<void>,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const flushBuffer = async (final = false) => {
    const parts = buffer.split(/\r?\n/);
    buffer = final ? '' : (parts.pop() ?? '');

    for (const line of parts) {
      await emitEventLine(line, onEvent);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    await flushBuffer(false);
  }

  buffer += decoder.decode();
  await flushBuffer(true);
}
