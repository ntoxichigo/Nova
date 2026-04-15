import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parseAuditDetails } from '@/lib/audit';

type IntelligenceNodeType =
  | 'conversation'
  | 'knowledge'
  | 'memory'
  | 'note'
  | 'skill'
  | 'script'
  | 'task'
  | 'event'
  | 'fact';

interface IntelligenceNode {
  id: string;
  type: IntelligenceNodeType;
  title: string;
  summary: string;
  createdAt: string;
  status?: string;
  tags?: string[];
  meta?: Record<string, unknown>;
}

function toDateString(value: Date | null | undefined) {
  return (value ?? new Date(0)).toISOString();
}

function includesQuery(parts: Array<string | null | undefined>, query: string) {
  if (!query) return true;
  const haystack = parts.filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(query);
}

function safeJsonArray(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get('q')?.trim().toLowerCase() || '';

    const [
      skills,
      knowledge,
      memories,
      notes,
      conversations,
      tasks,
      projects,
      relations,
      recentEvents,
    ] = await Promise.all([
      db.skill.findMany({ orderBy: { updatedAt: 'desc' }, take: 80 }),
      db.knowledge.findMany({ orderBy: { createdAt: 'desc' }, take: 120 }),
      db.agentMemory.findMany({ orderBy: [{ importance: 'desc' }, { lastAccessed: 'desc' }], take: 120 }),
      db.note.findMany({ orderBy: { updatedAt: 'desc' }, take: 60 }),
      db.conversation.findMany({
        orderBy: { createdAt: 'desc' },
        take: 80,
        include: { _count: { select: { messages: true } } },
      }),
      db.scheduledTask.findMany({ orderBy: { updatedAt: 'desc' }, take: 60 }),
      db.scriptProject.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 60,
        include: { _count: { select: { files: true, executions: true } } },
      }),
      db.memoryRelation.findMany({ orderBy: { createdAt: 'desc' }, take: 120 }),
      db.auditEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 80 }),
    ]);

    const nodes: IntelligenceNode[] = [];

    for (const skill of skills) {
      if (!includesQuery([skill.name, skill.description, skill.category], query)) continue;
      nodes.push({
        id: skill.id,
        type: 'skill',
        title: skill.name,
        summary: skill.description,
        createdAt: toDateString(skill.updatedAt),
        status: skill.isActive ? 'active' : 'inactive',
        tags: [skill.category],
      });
    }

    for (const entry of knowledge) {
      const tags = safeJsonArray(entry.tags);
      if (!includesQuery([entry.topic, entry.content, tags.join(' ')], query)) continue;
      nodes.push({
        id: entry.id,
        type: 'knowledge',
        title: entry.topic,
        summary: entry.content.slice(0, 220),
        createdAt: toDateString(entry.createdAt),
        tags,
      });
    }

    for (const memory of memories) {
      if (!includesQuery([memory.type, memory.content], query)) continue;
      nodes.push({
        id: memory.id,
        type: 'memory',
        title: memory.type,
        summary: memory.content.slice(0, 220),
        createdAt: toDateString(memory.createdAt),
        status: `importance-${memory.importance}`,
        tags: [memory.type],
        meta: {
          importance: memory.importance,
          accessCount: memory.accessCount,
        },
      });
    }

    for (const note of notes) {
      if (!includesQuery([note.title, note.content], query)) continue;
      nodes.push({
        id: note.id,
        type: 'note',
        title: note.title,
        summary: note.content.slice(0, 220),
        createdAt: toDateString(note.updatedAt),
      });
    }

    for (const conversation of conversations) {
      if (!includesQuery([conversation.title], query)) continue;
      nodes.push({
        id: conversation.id,
        type: 'conversation',
        title: conversation.title,
        summary: `${conversation._count.messages} messages`,
        createdAt: toDateString(conversation.createdAt),
        tags: conversation.pinned ? ['pinned'] : [],
      });
    }

    for (const task of tasks) {
      if (!includesQuery([task.name, task.prompt, task.cronExpr, task.lastResult], query)) continue;
      nodes.push({
        id: task.id,
        type: 'task',
        title: task.name,
        summary: task.prompt.slice(0, 220),
        createdAt: toDateString(task.updatedAt),
        status: task.enabled ? 'enabled' : 'disabled',
        tags: [task.channel, task.cronExpr],
      });
    }

    for (const project of projects) {
      if (!includesQuery([project.name, project.description], query)) continue;
      nodes.push({
        id: project.id,
        type: 'script',
        title: project.name,
        summary: `${project._count.files} files, ${project._count.executions} executions`,
        createdAt: toDateString(project.updatedAt),
        tags: ['project'],
      });
    }

    for (const relation of relations) {
      const sentence = `${relation.subject} ${relation.relation} ${relation.object}`;
      if (!includesQuery([sentence], query)) continue;
      nodes.push({
        id: relation.id,
        type: 'fact',
        title: sentence,
        summary: `Source: ${relation.source}`,
        createdAt: toDateString(relation.createdAt),
        tags: [relation.relation],
      });
    }

    for (const event of recentEvents) {
      const details = parseAuditDetails(event.details);
      if (!includesQuery([event.summary, event.source, event.action, event.entityLabel], query)) continue;
      nodes.push({
        id: event.id,
        type: 'event',
        title: event.summary,
        summary: `${event.source} · ${event.action}`,
        createdAt: toDateString(event.createdAt),
        status: event.status,
        tags: [event.source, event.severity],
        meta: details,
      });
    }

    const pendingReviews = recentEvents.filter((event) => event.status === 'review_required').length;
    const blockedActions = recentEvents.filter((event) => event.status === 'blocked').length;
    const failingTasks = tasks.filter((task) => task.lastResult.toLowerCase().startsWith('error')).length;

    const entityCounts = new Map<string, number>();
    for (const relation of relations) {
      const key = relation.object.trim();
      if (!key) continue;
      entityCounts.set(key, (entityCounts.get(key) || 0) + 1);
    }

    const hotEntities = [...entityCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, mentions]) => ({ name, mentions }));

    nodes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return NextResponse.json({
      counts: {
        skills: skills.length,
        knowledge: knowledge.length,
        memories: memories.length,
        notes: notes.length,
        conversations: conversations.length,
        tasks: tasks.length,
        projects: projects.length,
        facts: relations.length,
        pendingReviews,
        blockedActions,
        failingTasks,
      },
      highlights: {
        hotEntities,
        activeSkills: skills.filter((skill) => skill.isActive).length,
        recentFailures: recentEvents
          .filter((event) => event.status === 'error' || event.status === 'blocked')
          .slice(0, 6)
          .map((event) => ({
            id: event.id,
            summary: event.summary,
            source: event.source,
            status: event.status,
            createdAt: event.createdAt.toISOString(),
          })),
      },
      nodes: nodes.slice(0, 200),
      relations: relations.slice(0, 40).map((relation) => ({
        id: relation.id,
        subject: relation.subject,
        relation: relation.relation,
        object: relation.object,
        createdAt: relation.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error('intelligence map GET:', error);
    return NextResponse.json({ error: 'Failed to build intelligence map' }, { status: 500 });
  }
}
