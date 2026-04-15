import { db } from '@/lib/db';
import { parseAuditDetails, tryRecordAuditEvent } from '@/lib/audit';
import type { OrchestrationTraceInput, OrchestrationTelemetrySummary } from './types';

export async function recordOrchestrationTrace(input: OrchestrationTraceInput) {
  return tryRecordAuditEvent({
    source: input.source,
    action: 'orchestration_trace',
    entityType: 'agent_runtime',
    entityId: input.entityId || '',
    entityLabel: input.entityLabel || '',
    status: input.error ? 'error' : 'success',
    severity: input.error ? 'warning' : 'info',
    summary: input.error
      ? `Orchestration trace failed for ${input.source}`
      : `Orchestration trace recorded for ${input.source}`,
    conversationId: input.conversationId ?? null,
    details: input as unknown as Record<string, unknown>,
  });
}

export async function getOrchestrationTelemetrySummary(limit = 40): Promise<OrchestrationTelemetrySummary> {
  const events = await db.auditEvent.findMany({
    where: { action: 'orchestration_trace' },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const traces = events.map((event) => ({
    ...event,
    details: parseAuditDetails(event.details),
  }));

  const promptTokens = traces.reduce((sum, event) => sum + Number(event.details.promptTokens || 0), 0);
  const outputTokens = traces.reduce((sum, event) => sum + Number(event.details.outputTokens || 0), 0);
  const contextTokens = traces.reduce((sum, event) => sum + Number(event.details.contextTokens || 0), 0);
  const taskModeCounts = traces.reduce<Record<string, number>>((acc, event) => {
    const key = String(event.details.taskMode || 'unknown');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const autonomyCounts = traces.reduce<Record<string, number>>((acc, event) => {
    const key = String(event.details.autonomyProfile || 'unknown');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const toolCounts = traces.reduce<Record<string, number>>((acc, event) => {
    const tools = Array.isArray(event.details.toolsUsed) ? event.details.toolsUsed : [];
    for (const tool of tools) {
      const key = String(tool);
      acc[key] = (acc[key] || 0) + 1;
    }
    return acc;
  }, {});

  const topEntry = (counts: Record<string, number>) =>
    Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  return {
    totalRuns: traces.length,
    avgPromptTokens: traces.length ? Math.round(promptTokens / traces.length) : 0,
    avgOutputTokens: traces.length ? Math.round(outputTokens / traces.length) : 0,
    avgContextTokens: traces.length ? Math.round(contextTokens / traces.length) : 0,
    topTaskMode: topEntry(taskModeCounts),
    topAutonomyProfile: topEntry(autonomyCounts),
    topTool: topEntry(toolCounts),
    recentRuns: traces.slice(0, 10).map((trace) => ({
      id: trace.id,
      source: trace.source,
      createdAt: trace.createdAt,
      status: trace.status,
      taskMode: String(trace.details.taskMode || ''),
      autonomyProfile: String(trace.details.autonomyProfile || ''),
      promptTokens: Number(trace.details.promptTokens || 0),
      outputTokens: Number(trace.details.outputTokens || 0),
      model: String(trace.details.model || ''),
    })),
  };
}
