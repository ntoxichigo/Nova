import * as readline from 'node:readline';
import { streamLLM, type LLMMessage } from './llm.js';
import { conf } from './config.js';
import { buildSystemPrompt, parseTool, executeTool } from './tools.js';
import {
  printBanner, printHelp, printError, printInfo, C, hr, spinner,
} from './display.js';

export async function startChat(): Promise<void> {
  const config = conf.store;
  printBanner(config.provider, config.model);

  console.log(hr());
  console.log(C.muted('  Type your message, or /help for commands. Ctrl+C to exit.'));
  console.log(hr() + '\n');

  const messages: LLMMessage[] = [
    { role: 'system', content: buildSystemPrompt(config.agentName) },
  ];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  // Graceful exit on Ctrl+C or pipe close
  process.on('SIGINT', () => {
    console.log(C.muted('\n\n  Goodbye! 👋\n'));
    rl.close();
    process.exit(0);
  });
  rl.on('close', () => {
    console.log(C.muted('\n  Session ended.\n'));
    process.exit(0);
  });

  const showPrompt = () => {
    process.stdout.write(C.user(' You') + C.muted(' ▶  '));
  };

  // Event-based processing — pause/resume around streaming to avoid interleaving
  const processLine = async (line: string) => {
    rl.pause();
    const trimmed = line.trim();

    if (!trimmed) {
      rl.resume();
      showPrompt();
      return;
    }

    // ── Slash commands ───────────────────────────────────────────────────────
    if (trimmed.startsWith('/')) {
      switch (trimmed.split(' ')[0]?.toLowerCase()) {
        case '/exit':
        case '/quit':
          console.log(C.muted('\n  Goodbye! 👋\n'));
          rl.close();
          process.exit(0);
          break;
        case '/help':
          printHelp();
          break;
        case '/clear':
        case '/new':
          messages.splice(1); // keep system prompt
          printInfo('Conversation cleared.\n');
          break;
        case '/config': {
          console.log('\n' + hr());
          for (const [k, v] of Object.entries(conf.store)) {
            const val = k === 'apiKey' ? (String(v) ? '••••••••' : '(not set)') : String(v);
            console.log(`  ${C.secondary(k.padEnd(14))}  ${C.muted(val)}`);
          }
          console.log(C.dim(`\n  Config: ${conf.path}`));
          console.log(hr() + '\n');
          break;
        }
        default:
          printError(`Unknown command: ${trimmed}\nType /help for available commands.`);
          process.stdout.write('\n');
      }
      rl.resume();
      showPrompt();
      return;
    }

    // ── LLM turn ─────────────────────────────────────────────────────────────
    messages.push({ role: 'user', content: trimmed });

    const spin = spinner(' Thinking…');
    spin.start();

    try {
      const startMs   = Date.now();
      let fullContent = '';
      let firstChunk  = true;

      for await (const chunk of streamLLM(messages, config)) {
        if (firstChunk) {
          spin.stop();
          firstChunk = false;
          process.stdout.write('\n' + C.agent(` 🤖 ${config.agentName}\n\n`));
        }
        fullContent += chunk;
        process.stdout.write(C.agent(chunk));
      }

      if (firstChunk) spin.stop(); // LLM returned nothing

      // ── Tool execution ────────────────────────────────────────────────────
      const toolCalls = parseTool(fullContent);
      const toolResults: string[] = [];

      for (const tc of toolCalls) {
        process.stdout.write('\n' + C.tool(`  ⚡ running ${tc.name}…`));
        const result = await executeTool(tc);
        if (result.error) {
          process.stdout.write(C.error(`  ✗ ${result.error}\n`));
        } else {
          process.stdout.write(C.success('  ✓\n'));
          toolResults.push(`[${tc.name}]\n${result.content}`);
        }
      }

      // ── Follow-up stream if tools ran ─────────────────────────────────────
      if (toolResults.length > 0) {
        const stripped = fullContent.replace(/```tool[\s\S]*?```/g, '').trim();
        messages.push({ role: 'assistant', content: stripped || '(calling tools)' });
        messages.push({
          role: 'user',
          content: `TOOL RESULTS:\n\n${toolResults.join('\n\n')}\n\nAnswer the original question using the tool results above. Be concise.`,
        });

        process.stdout.write('\n' + C.agent(` 🤖 ${config.agentName}\n\n`));
        let followUp = '';
        for await (const chunk of streamLLM(messages, config)) {
          followUp += chunk;
          process.stdout.write(C.agent(chunk));
        }

        // Clean up injected tool messages from history
        messages.pop();
        messages.pop();
        messages.push({ role: 'assistant', content: followUp });
        fullContent = followUp;
      } else {
        messages.push({ role: 'assistant', content: fullContent });
      }

      // ── Stats line ────────────────────────────────────────────────────────
      const elapsedMs = Date.now() - startMs;
      const tokens    = Math.ceil(fullContent.length / 3.8);
      const tps       = tokens && elapsedMs ? Math.round(tokens / (elapsedMs / 1000)) : 0;
      const sep       = hr('═');
      process.stdout.write('\n');
      console.log(sep);
      console.log(C.muted(`  ↑ ~${tokens} tok · ${(elapsedMs / 1000).toFixed(1)}s${tps ? ` · ${tps} tok/s` : ''}`));
      console.log(sep);

    } catch (err) {
      spin.stop();
      const msg = err instanceof Error ? err.message : String(err);
      printError(`LLM error: ${msg}\n\nCheck your config with /config or run: nova setup`);
    }

    process.stdout.write('\n');
    rl.resume();
    showPrompt();
  };

  rl.on('line', (line) => void processLine(line));

  // Show initial prompt
  showPrompt();
}
