import { NextResponse } from 'next/server';
import { getOrchestrationTelemetrySummary } from '@/lib/orchestration/telemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const summary = await getOrchestrationTelemetrySummary();
    return NextResponse.json(summary, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load orchestration telemetry.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
