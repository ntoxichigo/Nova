import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parseAuditDetails } from '@/lib/audit';
import { getLLMConfig } from '@/lib/settings';
import { applyModelStabilityProfile } from '@/lib/llm/model-profiles';
import { getOrchestrationSettings } from '@/lib/orchestration/config';
import { runOrchestrationEvalSuite } from '@/lib/orchestration/evals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const events = await db.auditEvent.findMany({
      where: { action: 'orchestration_eval' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return NextResponse.json({
      runs: events.map((event) => ({
        id: event.id,
        createdAt: event.createdAt,
        status: event.status,
        summary: event.summary,
        result: parseAuditDetails(event.details),
      })),
    }, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load eval history.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const [baseConfig, settings] = await Promise.all([
      getLLMConfig(),
      getOrchestrationSettings(),
    ]);
    const { config } = applyModelStabilityProfile(baseConfig);
    const result = await runOrchestrationEvalSuite(config, settings);
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run orchestration evals.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
