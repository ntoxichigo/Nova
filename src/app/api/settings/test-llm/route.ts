import { NextResponse } from 'next/server';
import { getLLMConfig, setSetting } from '@/lib/settings';
import { classifyLLMError, createLLMProvider } from '@/lib/llm';
import { applyModelStabilityProfile } from '@/lib/llm/model-profiles';

export async function POST() {
  try {
    const config = await getLLMConfig();
    const { config: profiledConfig, profile } = applyModelStabilityProfile(config);
    const provider = createLLMProvider(profiledConfig);
    const result = await provider.testConnection();

    const providerNeedsRealChatProbe =
      profiledConfig.provider === 'xiaomi' ||
      profiledConfig.provider === 'openai' ||
      profiledConfig.provider === 'openrouter' ||
      (profiledConfig.provider === 'custom' && !/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(profiledConfig.baseUrl || ''));

    let chatReady = true;
    let chatProbeMessage = 'Chat probe skipped for local/offline provider.';
    let resolvedModel = String(result.model || profiledConfig.model || '').trim();

    if (result.success && providerNeedsRealChatProbe) {
      const probeConfig = {
        ...profiledConfig,
        model: resolvedModel || profiledConfig.model,
        maxTokens: Math.min(16, Math.max(8, profiledConfig.maxTokens ?? 16)),
        temperature: 0,
      };
      const probeProvider = createLLMProvider(probeConfig);
      try {
        const probe = await probeProvider.chat([{ role: 'user', content: 'Reply exactly with: ok' }]);
        resolvedModel = String(probe.model || probeConfig.model || resolvedModel).trim();
        chatProbeMessage = resolvedModel && resolvedModel !== probeConfig.model
          ? `Chat probe passed via fallback model "${resolvedModel}".`
          : 'Chat probe passed.';
      } catch (error: unknown) {
        // Xiaomi multimodal models can intermittently fail despite endpoint reachability.
        // Retry once with a stable MiMo chat-first model before marking as failed.
        if (profiledConfig.provider === 'xiaomi') {
          const fallbackModel = (String(profiledConfig.model || '').trim() === 'mimo-v2-pro')
            ? 'mimo-v2-flash'
            : 'mimo-v2-pro';
          const fallbackProbeConfig = {
            ...probeConfig,
            model: fallbackModel,
          };
          const fallbackProbeProvider = createLLMProvider(fallbackProbeConfig);
          try {
            const fallbackProbe = await fallbackProbeProvider.chat([{ role: 'user', content: 'Reply exactly with: ok' }]);
            chatReady = true;
            resolvedModel = String(fallbackProbe.model || fallbackModel || resolvedModel).trim();
            chatProbeMessage = `Chat probe passed via MiMo fallback model "${resolvedModel}" after primary probe failed.`;
          } catch (fallbackError: unknown) {
            chatReady = false;
            const classified = classifyLLMError(fallbackError);
            chatProbeMessage = `Chat probe failed: ${classified.message}`;
          }
        } else {
          chatReady = false;
          const classified = classifyLLMError(error);
          chatProbeMessage = `Chat probe failed: ${classified.message}`;
        }
      }
    }

    const success = result.success && chatReady;
    const message = !result.success
      ? result.message
      : chatReady
        ? `${result.message} ${chatProbeMessage}`
        : `${result.message} ${chatProbeMessage}`;

    const shouldPersistResolvedModel =
      success &&
      profiledConfig.provider === 'xiaomi' &&
      resolvedModel &&
      resolvedModel !== String(profiledConfig.model || '').trim();

    if (shouldPersistResolvedModel) {
      await setSetting('llm_model', resolvedModel);
    }

    return NextResponse.json({
      ...result,
      success,
      message,
      chatReady,
      connectionReady: result.success,
      resolvedModel,
      model: resolvedModel || result.model,
      modelAutoUpdated: shouldPersistResolvedModel,
      modelProfile: profile,
      appliedConfig: {
        model: resolvedModel || profiledConfig.model,
        maxTokens: profiledConfig.maxTokens,
        contextWindow: profiledConfig.contextWindow,
        qualityMode: profiledConfig.qualityMode,
      },
    }, { status: success ? 200 : 502 });
  } catch (error: unknown) {
    console.error('LLM test connection failed:', error);
    const message = error instanceof Error ? error.message : 'Connection test failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
