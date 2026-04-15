import { db } from '@/lib/db';

export type AuditEventStatus =
  | 'success'
  | 'error'
  | 'blocked'
  | 'review_required'
  | 'approved'
  | 'rejected';

export type AuditEventSeverity = 'info' | 'warning' | 'critical';

export interface AuditEventInput {
  source: string;
  action: string;
  summary: string;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
  status?: AuditEventStatus;
  severity?: AuditEventSeverity;
  details?: Record<string, unknown>;
  conversationId?: string | null;
}

function safeStringify(value: Record<string, unknown> | undefined) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
}

export async function recordAuditEvent(input: AuditEventInput) {
  return db.auditEvent.create({
    data: {
      source: input.source,
      action: input.action,
      entityType: input.entityType ?? '',
      entityId: input.entityId ?? '',
      entityLabel: input.entityLabel ?? '',
      status: input.status ?? 'success',
      severity: input.severity ?? 'info',
      summary: input.summary,
      details: safeStringify(input.details),
      conversationId: input.conversationId ?? null,
    },
  });
}

export async function tryRecordAuditEvent(input: AuditEventInput) {
  try {
    return await recordAuditEvent(input);
  } catch (error) {
    console.error('audit log failed:', error);
    return null;
  }
}

export function parseAuditDetails(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
