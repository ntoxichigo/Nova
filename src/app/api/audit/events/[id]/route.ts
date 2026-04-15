import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { allTools } from '@/lib/tools/executors';
import type { ToolDefinition } from '@/lib/tools/types';
import { callMCPTool, discoverMCPTools } from '@/lib/mcp/client';
import { parseAuditDetails, tryRecordAuditEvent } from '@/lib/audit';

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function buildRuntimeTools(): Promise<ToolDefinition[]> {
  const tools = [...allTools];

  try {
    const mcpTools = await discoverMCPTools();
    for (const tool of mcpTools) {
      if (tools.some((entry) => entry.name === tool.name)) {
        continue;
      }

      tools.push({
        name: tool.name,
        description: tool.description,
        parameters: (tool.inputSchema as ToolDefinition['parameters']) || { type: 'object', properties: {} },
        async execute(args) {
          try {
            const result = await callMCPTool(tool.name, args);
            return { toolName: tool.name, content: result.slice(0, 4000) };
          } catch (error) {
            return {
              toolName: tool.name,
              content: '',
              error: error instanceof Error ? error.message : 'MCP execution failed',
            };
          }
        },
      });
    }
  } catch {
    // Mission Control should still work even if MCP discovery is unavailable.
  }

  return tools;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = (await request.json()) as { decision?: 'approve' | 'reject' };
    const decision = body.decision;

    if (decision !== 'approve' && decision !== 'reject') {
      return NextResponse.json({ error: 'decision must be approve or reject' }, { status: 400 });
    }

    const event = await db.auditEvent.findUnique({ where: { id } });
    if (!event) {
      return NextResponse.json({ error: 'Audit event not found' }, { status: 404 });
    }

    if (event.status !== 'review_required') {
      return NextResponse.json({ error: 'Only review_required events can be resolved' }, { status: 400 });
    }

    const details = parseAuditDetails(event.details);

    if (decision === 'reject') {
      const updated = await db.auditEvent.update({
        where: { id },
        data: {
          status: 'rejected',
          severity: 'warning',
          summary: `Rejected: ${event.summary}`,
        },
      });

      return NextResponse.json({ ...updated, details });
    }

    const toolName = typeof details.toolName === 'string' ? details.toolName : '';
    const args =
      details.arguments && typeof details.arguments === 'object' && !Array.isArray(details.arguments)
        ? (details.arguments as Record<string, unknown>)
        : {};

    if (!toolName) {
      return NextResponse.json({ error: 'This review item does not contain an executable tool' }, { status: 400 });
    }

    const tools = await buildRuntimeTools();
    const tool = tools.find((entry) => entry.name === toolName);
    if (!tool) {
      return NextResponse.json({ error: `Tool "${toolName}" is no longer available` }, { status: 404 });
    }

    const result = await tool.execute(args);
    const output = (result.error || result.content || '').slice(0, 4000);

    const updated = await db.auditEvent.update({
      where: { id },
      data: {
        status: result.error ? 'error' : 'approved',
        severity: result.error ? 'warning' : event.severity,
        summary: result.error ? `Approval failed for ${toolName}` : `Approved and executed ${toolName}`,
        details: JSON.stringify({
          ...details,
          approvedAt: new Date().toISOString(),
          approvalResult: output,
        }),
      },
    });

    if (!result.error && event.conversationId) {
      await db.message.create({
        data: {
          conversationId: event.conversationId,
          role: 'assistant',
          content: `Mission Control approved \`${toolName}\` and executed it.\n\n${result.content}`,
          skillsUsed: '[]',
          toolCalls: JSON.stringify([toolName]),
          modelUsed: 'mission-control',
        },
      }).catch(() => {});
    }

    await tryRecordAuditEvent({
      source: 'mission-control',
      action: 'review_resolution',
      entityType: 'audit_event',
      entityId: updated.id,
      entityLabel: toolName,
      status: result.error ? 'error' : 'approved',
      severity: result.error ? 'warning' : 'info',
      summary: result.error ? `Mission Control approval failed for ${toolName}` : `Mission Control approved ${toolName}`,
      details: {
        reviewEventId: updated.id,
        toolName,
      },
      conversationId: event.conversationId,
    });

    return NextResponse.json({
      ...updated,
      details: parseAuditDetails(updated.details),
      result,
    });
  } catch (error) {
    console.error('audit review PATCH:', error);
    return NextResponse.json({ error: 'Failed to resolve audit review' }, { status: 500 });
  }
}
