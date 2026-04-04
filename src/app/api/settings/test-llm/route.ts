import { NextResponse } from 'next/server';
import { getLLMConfig } from '@/lib/settings';
import { createLLMProvider } from '@/lib/llm';

export async function POST() {
  try {
    const config = await getLLMConfig();
    const provider = createLLMProvider(config);
    const success = await provider.testConnection();
    return NextResponse.json({ success, provider: provider.name });
  } catch (error: unknown) {
    console.error('LLM test connection failed:', error);
    const message = error instanceof Error ? error.message : 'Connection test failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
