export interface LlmPreset {
  id: string;
  label: string;
  description: string;
  settings: Record<string, string>;
}

export const LLM_PRESETS: LlmPreset[] = [
  {
    id: 'mimo-pro-balanced',
    label: 'MiMo Pro (Balanced)',
    description: 'MiMo V2 Pro as strong model with MiMo Flash for fast chat and Pro for coding/review.',
    settings: {
      llm_provider: 'xiaomi',
      llm_model: 'mimo-v2-pro',
      llm_fast_model: 'mimo-v2-flash',
      llm_strong_model: 'mimo-v2-pro',
      llm_audit_model: 'mimo-v2-pro',
      llm_coder_model: 'mimo-v2-pro',
      llm_verifier_model: 'mimo-v2-pro',
      llm_research_model: 'mimo-v2-pro',
      llm_quality_mode: 'high-context',
      llm_router_enabled: 'true',
      llm_scoped_agents_enabled: 'true',
      chat_speed_mode: 'balanced',
    },
  },
  {
    id: 'mimo-flash-fast',
    label: 'MiMo Flash (Fast)',
    description: 'MiMo V2 Flash as default fast lane; Pro reserved for deep coding and verification.',
    settings: {
      llm_provider: 'xiaomi',
      llm_model: 'mimo-v2-flash',
      llm_fast_model: 'mimo-v2-flash',
      llm_strong_model: 'mimo-v2-pro',
      llm_audit_model: 'mimo-v2-pro',
      llm_coder_model: 'mimo-v2-pro',
      llm_verifier_model: 'mimo-v2-pro',
      llm_research_model: 'mimo-v2-pro',
      llm_quality_mode: 'balanced',
      llm_router_enabled: 'true',
      llm_scoped_agents_enabled: 'true',
      chat_speed_mode: 'simple',
    },
  },
  {
    id: 'local-balanced',
    label: 'Local Models (Balanced)',
    description: 'Keep local/provider model as is, with router/scoped specialists on and balanced latency.',
    settings: {
      llm_fast_model: '',
      llm_strong_model: '',
      llm_audit_model: '',
      llm_quality_mode: 'local-safe',
      llm_router_enabled: 'true',
      llm_scoped_agents_enabled: 'true',
      chat_speed_mode: 'balanced',
    },
  },
  {
    id: 'openrouter-fast',
    label: 'OpenRouter Fast',
    description: 'Gemini Flash for simple chat, Qwen3 Coder for coding, DeepSeek R1 for review/research.',
    settings: {
      llm_provider: 'openrouter',
      llm_model: 'google/gemini-2.5-flash',
      llm_fast_model: 'google/gemini-2.5-flash',
      llm_strong_model: 'qwen/qwen3-coder',
      llm_audit_model: 'deepseek/deepseek-r1-0528',
      llm_coder_model: 'qwen/qwen3-coder',
      llm_verifier_model: 'deepseek/deepseek-r1-0528',
      llm_research_model: 'deepseek/deepseek-r1-0528',
      llm_quality_mode: 'balanced',
      llm_router_enabled: 'true',
      llm_scoped_agents_enabled: 'true',
      chat_speed_mode: 'simple',
    },
  },
];

export function getLlmPresetById(id: string): LlmPreset | undefined {
  return LLM_PRESETS.find((preset) => preset.id === id);
}
