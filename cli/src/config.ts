import Conf from 'conf';
import os from 'node:os';
import path from 'node:path';

export interface NovaConfig {
  provider: 'ollama' | 'openai' | 'lmstudio' | 'custom';
  model: string;
  baseUrl: string;
  apiKey: string;
  agentName: string;
  theme: 'dark' | 'light';
  stream: boolean;
}

export const conf = new Conf<NovaConfig>({
  projectName: 'nova-cli',
  defaults: {
    provider: 'ollama',
    model: 'llama3',
    baseUrl: 'http://localhost:11434',
    apiKey: '',
    agentName: 'Nova',
    theme: 'dark',
    stream: true,
  },
});

export const DATA_DIR = path.join(os.homedir(), '.nova');
