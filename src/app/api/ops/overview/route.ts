import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parseAuditDetails } from '@/lib/audit';
import { getAllSettings } from '@/lib/settings';
import { getOperatingSystemState } from '@/lib/operating-system';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseStringArray(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function avg(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function countBy<T extends string>(items: T[]) {
  const map = new Map<string, number>();
  for (const item of items) {
    map.set(item, (map.get(item) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

function isRecent(date: Date, minutes: number) {
  return Date.now() - date.getTime() <= minutes * 60 * 1000;
}

export async function GET() {
  try {
    const [settings, operatingSystem, connections, recentMessages, recentAuditEvents, recentProjects, recentTasks, recentCommands, recentExecutions, recentIdeMessages] = await Promise.all([
      getAllSettings(),
      getOperatingSystemState(),
      db.connection.findMany({ orderBy: { updatedAt: 'desc' } }),
      db.message.findMany({
        orderBy: { createdAt: 'desc' },
        take: 40,
        select: {
          id: true,
          role: true,
          content: true,
          latencyMs: true,
          tokenCount: true,
          toolCalls: true,
          modelUsed: true,
          createdAt: true,
          conversationId: true,
        },
      }),
      db.auditEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 40,
      }),
      db.scriptProject.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 8,
        include: {
          _count: {
            select: {
              files: true,
              commands: true,
              executions: true,
            },
          },
        },
      }),
      db.scheduledTask.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 12,
      }),
      db.scriptCommandExecution.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          project: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      db.scriptExecution.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          project: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      db.scriptMessage.findMany({
        orderBy: { createdAt: 'desc' },
        take: 24,
        include: {
          project: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
    ]);

    const assistantMessages = recentMessages.filter((message) => message.role === 'assistant');
    const latencyValues = assistantMessages.map((message) => message.latencyMs || 0).filter((value) => value > 0);
    const tokenValues = assistantMessages.map((message) => message.tokenCount || 0).filter((value) => value > 0);
    const toolNames = assistantMessages.flatMap((message) => parseStringArray(message.toolCalls));
    const ideToolNames = recentIdeMessages.flatMap((message) => parseStringArray(message.toolCalls));
    const modelsUsed = assistantMessages.map((message) => message.modelUsed).filter(Boolean);

    const runningCommands = recentCommands.filter((run) => run.status === 'pending' || run.status === 'running');
    const runningExecutions = recentExecutions.filter((run) => run.status === 'pending' || run.status === 'running');
    const pendingReviews = recentAuditEvents.filter((event) => event.status === 'review_required');
    const blockedEvents = recentAuditEvents.filter((event) => event.status === 'blocked');
    const errorEvents = recentAuditEvents.filter((event) => event.status === 'error');
    const activeTasks = recentTasks.filter((task) => task.enabled);
    const recentlyActiveTasks = recentTasks.filter((task) => task.lastRunAt && isRecent(task.lastRunAt, 24 * 60));

    const feed = [
      ...recentAuditEvents.map((event) => ({
        id: `audit-${event.id}`,
        lane: 'audit',
        title: event.summary,
        status: event.status,
        subtitle: `${event.source} · ${event.action}`,
        createdAt: event.createdAt.toISOString(),
        details: parseAuditDetails(event.details),
      })),
      ...recentCommands.map((run) => ({
        id: `command-${run.id}`,
        lane: 'command',
        title: run.command,
        status: run.status,
        subtitle: run.project.name,
        createdAt: run.createdAt.toISOString(),
        details: {
          exitCode: run.exitCode,
          duration: run.duration,
        },
      })),
      ...recentExecutions.map((run) => ({
        id: `execution-${run.id}`,
        lane: 'execution',
        title: run.status === 'error' ? 'Project execution failed' : 'Project execution',
        status: run.status,
        subtitle: run.project.name,
        createdAt: run.createdAt.toISOString(),
        details: {
          duration: run.duration,
        },
      })),
    ]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 24);

    const recommendations = [...operatingSystem.recommendations];
    if (runningCommands.length === 0 && runningExecutions.length === 0) {
      recommendations.push('No live project runs are active right now. Use Ops during a real build/debug session to validate the operator loop.');
    }
    if (activeTasks.length === 0) {
      recommendations.push('Automation exists but no scheduled tasks are enabled. Promote one stable workflow into the scheduler.');
    }
    if (blockedEvents.length > 6) {
      recommendations.push('Mission Control is blocking frequently. Tighten prompts or rebalance tool policies so the model stops hitting unnecessary walls.');
    }
    if (assistantMessages.length > 0 && avg(tokenValues) > 4500 && toolNames.length === 0) {
      recommendations.push('Average chat output is heavy even on non-tool turns. Add more fast-path routing or simpler response policy for low-complexity prompts.');
    }
    const memoryUsageEvents = recentAuditEvents
      .filter((event) => event.action === 'memory_context_used')
      .slice(0, 8)
      .map((event) => {
        const details = parseAuditDetails(event.details);
        const memoryUsed = Array.isArray(details.memoryUsed) ? details.memoryUsed : [];
        return {
          id: event.id,
          createdAt: event.createdAt.toISOString(),
          summary: event.summary,
          memoryScope: details.memoryScope ? String(details.memoryScope) : 'unknown',
          memoryUsed: memoryUsed
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => ({
              type: String((entry as Record<string, unknown>).type || 'memory'),
              content: String((entry as Record<string, unknown>).content || ''),
              source: (entry as Record<string, unknown>).source ? String((entry as Record<string, unknown>).source) : undefined,
            })),
        };
      });

    return NextResponse.json({
      snapshotAt: new Date().toISOString(),
      runtime: {
        provider: settings.llm_provider || 'z-ai',
        model: settings.llm_model || '',
        operatingProfile: operatingSystem.selectedProfile,
        automationMode: operatingSystem.automationMode,
        workspaceRootConfigured: operatingSystem.workspaceRootConfigured,
        chatPowerMode: settings.chat_power_mode || 'builder',
        chatPermissionMode: settings.chat_permission_mode || 'always_ask',
        chatSpeedMode: settings.chat_speed_mode || 'balanced',
        autonomyProfile: settings.agent_autonomy_profile || 'builder',
        routerEnabled: String(settings.llm_router_enabled || 'true').toLowerCase() !== 'false',
        scopedAgentsEnabled: String(settings.llm_scoped_agents_enabled || 'true').toLowerCase() !== 'false',
        tokenTelemetryEnabled: String(settings.llm_token_telemetry_enabled || 'true').toLowerCase() !== 'false',
        connections: connections.map((connection) => connection.service),
      },
      live: {
        activeCommands: runningCommands.length,
        activeExecutions: runningExecutions.length,
        pendingReviews: pendingReviews.length,
        blockedActions24h: blockedEvents.length,
        recentErrors: errorEvents.length,
        enabledTasks: operatingSystem.enabledTasksCount,
      },
      chat: {
        assistantTurns: assistantMessages.length,
        avgLatencyMs: avg(latencyValues),
        avgTokens: avg(tokenValues),
        topModels: countBy(modelsUsed).slice(0, 6),
        topTools: countBy(toolNames).slice(0, 8),
      },
      ide: {
        recentProjects: recentProjects.map((project) => ({
          id: project.id,
          name: project.name,
          description: project.description,
          updatedAt: project.updatedAt.toISOString(),
          files: project._count.files,
          commands: project._count.commands,
          executions: project._count.executions,
        })),
        topIdeTools: countBy(ideToolNames).slice(0, 8),
        recentCommands: recentCommands.slice(0, 10).map((run) => ({
          id: run.id,
          command: run.command,
          status: run.status,
          exitCode: run.exitCode,
          duration: run.duration,
          createdAt: run.createdAt.toISOString(),
          projectName: run.project.name,
        })),
        recentExecutions: recentExecutions.slice(0, 10).map((run) => ({
          id: run.id,
          status: run.status,
          duration: run.duration,
          createdAt: run.createdAt.toISOString(),
          projectName: run.project.name,
        })),
      },
      automation: {
        totalTasks: operatingSystem.scheduledTasksCount,
        enabledTasks: operatingSystem.enabledTasksCount,
        recentlyActiveTasks: recentlyActiveTasks.length,
        tasks: recentTasks.slice(0, 10).map((task) => ({
          id: task.id,
          name: task.name,
          enabled: task.enabled,
          channel: task.channel,
          cronExpr: task.cronExpr,
          lastRunAt: task.lastRunAt?.toISOString() || null,
          lastResult: task.lastResult.slice(0, 180),
        })),
      },
      operatingSystem,
      memoryUsage: memoryUsageEvents,
      activityFeed: feed,
      recommendations: recommendations.slice(0, 8),
    }, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('ops overview GET:', error);
    return NextResponse.json({ error: 'Failed to load ops overview.' }, { status: 500 });
  }
}
