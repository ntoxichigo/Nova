import { Command } from 'commander';
import { conf } from './config.js';
import { C, hr, printBanner } from './display.js';
import { runSetup } from './setup.js';
import { startChat } from './chat.js';

const program = new Command();

program
  .name('nova')
  .description('Nova AI Agent - Personal CLI')
  .version('2.0.0', '-v, --version', 'Show version number')
  .helpOption('-h, --help', 'Show help')
  // Default action: interactive chat
  .action(async () => {
    const configured = conf.get('model') && conf.get('baseUrl');
    if (!configured) {
      console.log(C.warning('\n  No config found - running setup first.\n'));
      await runSetup(false);
    }
    await startChat();
  });

// --- setup ------------------------------------------------------------
program
  .command('setup')
  .description('Configure LLM provider, model, and agent settings')
  .action(async () => runSetup());

// --- ask --------------------------------------------------------------
program
  .command('ask <message...>')
  .description('Ask a single question and print the response (non-interactive)')
  .action(async (parts: string[]) => {
    const { streamLLM } = await import('./llm.js');
    const { buildSystemPrompt, parseTool, executeTool } = await import('./tools.js');

    const config = conf.store;
    const message = parts.join(' ');
    const messages = [
      { role: 'system' as const, content: buildSystemPrompt(config.agentName) },
      { role: 'user' as const, content: message },
    ];

    process.stderr.write(C.muted(`\n[agent] ${config.agentName}\n\n`));

    let full = '';
    for await (const chunk of streamLLM(messages, config)) {
      full += chunk;
      process.stdout.write(chunk);
    }
    process.stdout.write('\n');

    // Handle any tool calls
    const toolCalls = parseTool(full);
    for (const tc of toolCalls) {
      process.stderr.write(C.tool(`* ${tc.name}...\n`));
      const result = await executeTool(tc);
      if (result.error) {
        process.stderr.write(C.error(`x ${result.error}\n`));
        continue;
      }
      process.stderr.write(C.success(`ok ${tc.name}\n`));

      const followUp = [
        ...messages,
        { role: 'assistant' as const, content: full },
        { role: 'user' as const, content: `TOOL RESULTS:\n[${tc.name}]\n${result.content}\n\nAnswer the original question.` },
      ];
      for await (const chunk of streamLLM(followUp, config)) {
        process.stdout.write(chunk);
      }
      process.stdout.write('\n');
    }
  });

// --- config -----------------------------------------------------------
program
  .command('config')
  .description('Show or reset configuration')
  .option('--show', 'Print current configuration (default)')
  .option('--reset', 'Reset configuration to defaults')
  .action((opts: { show?: boolean; reset?: boolean }) => {
    if (opts.reset) {
      conf.clear();
      console.log(C.success('\n  OK Config reset to defaults.\n'));
      return;
    }
    printBanner();
    console.log('\n' + hr());
    console.log(C.bold(C.primary('  Configuration\n')));
    for (const [k, v] of Object.entries(conf.store)) {
      const val = k === 'apiKey' ? (String(v) ? '********' : '(not set)') : String(v);
      console.log(`  ${C.secondary(k.padEnd(14))}  ${C.muted(val)}`);
    }
    console.log(C.dim(`\n  Config file: ${conf.path}`));
    console.log(hr() + '\n');
  });

program.parse();

