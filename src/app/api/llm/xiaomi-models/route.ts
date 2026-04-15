import { NextResponse } from 'next/server';
import { XIAOMI_MODELS } from '@/lib/llm/xiaomi-models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    models: XIAOMI_MODELS,
    meta: {
      source: 'official-xiaomi-mimo-docs',
      fetchedAt: new Date().toISOString(),
      totalCount: XIAOMI_MODELS.length,
    },
  });
}
