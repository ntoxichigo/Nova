import { input, password, select, confirm } from '@inquirer/prompts';
import { conf, type NovaConfig } from './config.js';
import { printBanner, printSuccess, printInfo, C } from './display.js';

export async function runSetup(quiet = false): Promise<void> {
  if (!quiet) {
    printBanner();
    console.log(C.bold(C.primary(' Welcome to Nova CLI Setup\n')));
    console.log(C.muted(' This wizard configures your LLM provider.\n'));
  }

  const provider = await select<NovaConfig['provider']>({
    message: 'Select your LLM provider:',
    choices: [
      { name: 'Ollama  (local, free, private)', value: 'ollama' },
      { name: 'LM Studio  (local)', value: 'lmstudio' },
      { name: 'OpenAI / Groq / Together AI', value: 'openai' },
      { name: 'Custom OpenAI-compatible endpoint', value: 'custom' },
    ],
  });

  let model   = '';
  let baseUrl = '';
  let apiKey  = '';

  if (provider === 'ollama') {
    baseUrl = await input({ message: 'Ollama URL:', default: 'http://localhost:11434' });

    // Auto-detect available models
    let ollamaModels: string[] = [];
    try {
      const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = (await res.json()) as { models?: Array<{ name: string }> };
        ollamaModels = data.models?.map((m) => m.name) ?? [];
      }
    } catch { /* Ollama not running */ }

    if (ollamaModels.length > 0) {
      model = await select({
        message: 'Select model:',
        choices: ollamaModels.map((m) => ({ name: m, value: m })),
      });
    } else {
      if (ollamaModels.length === 0) {
        console.log(C.warning('\n  ⚠  No models found. Run: ollama pull llama3\n'));
      }
      model = await input({ message: 'Model name:', default: 'llama3' });
    }

  } else if (provider === 'lmstudio') {
    baseUrl = await input({ message: 'LM Studio URL:', default: 'http://localhost:1234/v1' });
    model   = await input({ message: 'Model name:', default: 'default' });

  } else if (provider === 'openai') {
    baseUrl = await input({ message: 'API Base URL:', default: 'https://api.openai.com/v1' });
    apiKey  = await password({ message: 'API Key (sk-…):', mask: '*' });
    model   = await input({ message: 'Model name:', default: 'gpt-4o' });

  } else {
    baseUrl = await input({ message: 'Endpoint URL:' });
    const needsKey = await confirm({ message: 'Does this endpoint require an API key?' });
    if (needsKey) apiKey = await password({ message: 'API Key:', mask: '*' });
    model = await input({ message: 'Model name:' });
  }

  const agentName = await input({
    message: 'Agent name:',
    default: conf.get('agentName') || 'Nova',
  });

  conf.set('provider', provider);
  conf.set('model', model);
  conf.set('baseUrl', baseUrl);
  conf.set('apiKey', apiKey);
  conf.set('agentName', agentName);

  console.log();
  printSuccess(`Configuration saved → ${conf.path}`);
  printInfo('Run nova to start chatting!\n');
}
