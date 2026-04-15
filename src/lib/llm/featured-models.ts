/**
 * Hardcoded featured OpenRouter models — used as fallback when API is unavailable
 * and as the "Featured" tab content.
 */

export interface FeaturedModel {
  id: string;
  name: string;
  provider: string;
  contextK: number; // context window in thousands
  badge: string;
  badgeColor: 'blue' | 'green' | 'purple' | 'orange' | 'gray';
  isFree: boolean;
}

export const FEATURED_OPENROUTER_MODELS: FeaturedModel[] = [
  // Top-tier general
  {
    id: 'anthropic/claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    provider: 'Anthropic',
    contextK: 200,
    badge: 'Best Overall',
    badgeColor: 'blue',
    isFree: false,
  },
  {
    id: 'openai/gpt-4.1',
    name: 'GPT-4.1',
    provider: 'OpenAI',
    contextK: 1000,
    badge: 'Popular',
    badgeColor: 'blue',
    isFree: false,
  },
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'Google',
    contextK: 1048,
    badge: 'Fastest',
    badgeColor: 'green',
    isFree: false,
  },
  {
    id: 'x-ai/grok-4',
    name: 'Grok 4',
    provider: 'xAI',
    contextK: 256,
    badge: 'Frontier',
    badgeColor: 'purple',
    isFree: false,
  },
  // Best value
  {
    id: 'deepseek/deepseek-chat-v3-0324',
    name: 'DeepSeek V3',
    provider: 'DeepSeek',
    contextK: 163,
    badge: 'Best Value',
    badgeColor: 'orange',
    isFree: false,
  },
  {
    id: 'openai/gpt-4.1-mini',
    name: 'GPT-4.1 Mini',
    provider: 'OpenAI',
    contextK: 1000,
    badge: 'Budget',
    badgeColor: 'orange',
    isFree: false,
  },
  {
    id: 'google/gemini-2.0-flash-lite-001',
    name: 'Gemini 2.0 Flash Lite',
    provider: 'Google',
    contextK: 1048,
    badge: 'Ultra Cheap',
    badgeColor: 'green',
    isFree: false,
  },
  // Reasoning
  {
    id: 'deepseek/deepseek-r1-0528',
    name: 'DeepSeek R1',
    provider: 'DeepSeek',
    contextK: 163,
    badge: 'Reasoning',
    badgeColor: 'purple',
    isFree: false,
  },
  {
    id: 'openai/o4-mini',
    name: 'o4-mini',
    provider: 'OpenAI',
    contextK: 200,
    badge: 'Reasoning',
    badgeColor: 'purple',
    isFree: false,
  },
  {
    id: 'qwen/qwen3-235b-a22b',
    name: 'Qwen3 235B',
    provider: 'Qwen',
    contextK: 131,
    badge: 'Reasoning',
    badgeColor: 'purple',
    isFree: false,
  },
  // Coding
  {
    id: 'mistralai/codestral-2508',
    name: 'Codestral',
    provider: 'Mistral',
    contextK: 256,
    badge: 'Coding',
    badgeColor: 'blue',
    isFree: false,
  },
  {
    id: 'qwen/qwen3-coder',
    name: 'Qwen3 Coder 480B',
    provider: 'Qwen',
    contextK: 262,
    badge: 'Coding',
    badgeColor: 'blue',
    isFree: false,
  },
  // Open source / free
  {
    id: 'openrouter/free',
    name: 'Free Models Router',
    provider: 'OpenRouter',
    contextK: 200,
    badge: 'Always Free',
    badgeColor: 'green',
    isFree: true,
  },
  {
    id: 'google/gemma-3-27b-it:free',
    name: 'Gemma 3 27B',
    provider: 'Google',
    contextK: 131,
    badge: 'Free',
    badgeColor: 'green',
    isFree: true,
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    name: 'Llama 3.3 70B',
    provider: 'Meta',
    contextK: 131,
    badge: 'Free',
    badgeColor: 'green',
    isFree: true,
  },
  // Misc strong models
  {
    id: 'anthropic/claude-3-5-haiku',
    name: 'Claude 3.5 Haiku',
    provider: 'Anthropic',
    contextK: 200,
    badge: 'Fast Chat',
    badgeColor: 'orange',
    isFree: false,
  },
  {
    id: 'mistralai/mistral-small-3.2-24b-instruct',
    name: 'Mistral Small 3.2',
    provider: 'Mistral',
    contextK: 131,
    badge: 'Efficient',
    badgeColor: 'gray',
    isFree: false,
  },
  {
    id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
    name: 'Nemotron Ultra 253B',
    provider: 'NVIDIA',
    contextK: 131,
    badge: 'NVIDIA Pick',
    badgeColor: 'green',
    isFree: false,
  },
  {
    id: 'qwen/qwen3-30b-a3b',
    name: 'Qwen3 30B',
    provider: 'Qwen',
    contextK: 131,
    badge: 'Balanced',
    badgeColor: 'gray',
    isFree: false,
  },
  {
    id: 'openai/gpt-oss-120b:free',
    name: 'gpt-oss-120b',
    provider: 'OpenAI',
    contextK: 131,
    badge: 'Open Weight',
    badgeColor: 'gray',
    isFree: true,
  },
];
