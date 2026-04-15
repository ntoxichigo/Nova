import { NextRequest, NextResponse } from 'next/server';
import { invalidateMCPServer } from '@/lib/mcp/client';
import { db } from '@/lib/db';
import { tryRecordAuditEvent } from '@/lib/audit';

type MCPTransport = 'stdio' | 'sse';

function validateTransport(value: unknown): MCPTransport {
  if (value === 'stdio' || value === 'sse') return value;
  return 'stdio';
}

function normalizeName(value: unknown): string {
  const name = String(value || '').trim();
  if (!name) throw new Error('name required');
  if (!/^[a-zA-Z0-9- ]{1,60}$/.test(name)) {
    throw new Error('name must be 1-60 chars using letters, numbers, spaces, or hyphens');
  }
  return name;
}

function normalizeArgs(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error('args must be an array of strings');
  }
  return value.map((entry) => entry.trim()).filter(Boolean);
}

function normalizeEnv(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('env must be an object of string values');
  }

  const entries = Object.entries(value);
  const normalized: Record<string, string> = {};
  for (const [key, envValue] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid env key "${key}"`);
    }
    if (typeof envValue !== 'string') {
      throw new Error(`Env value for "${key}" must be a string`);
    }
    normalized[key] = envValue;
  }
  return normalized;
}

function normalizeUrl(value: unknown): string {
  const url = String(value || '').trim();
  if (!url) return '';
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('url must use http:// or https://');
  }
  return url.replace(/\/+$/, '');
}

function normalizeCommand(value: unknown): string {
  return String(value || '').trim();
}

function validateServerPayload(body: {
  name?: string;
  transport?: string;
  command?: string;
  url?: string;
  args?: string[];
  env?: Record<string, string>;
}) {
  const name = normalizeName(body.name);
  const transport = validateTransport(body.transport);
  const command = normalizeCommand(body.command);
  const url = normalizeUrl(body.url);
  const args = normalizeArgs(body.args);
  const env = normalizeEnv(body.env);

  if (transport === 'stdio' && !command) {
    throw new Error('command required for stdio servers');
  }
  if (transport === 'sse' && !url) {
    throw new Error('url required for sse servers');
  }

  return { name, transport, command, url, args, env };
}

export async function GET() {
  try {
    const servers = await db.mCPServer.findMany({ orderBy: { createdAt: 'desc' } });
    return NextResponse.json(servers);
  } catch (error) {
    console.error('mcp GET:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      name?: string;
      transport?: string;
      command?: string;
      url?: string;
      args?: string[];
      env?: Record<string, string>;
    };

    const normalized = validateServerPayload(body);
    const server = await db.mCPServer.create({
      data: {
        name: normalized.name,
        transport: normalized.transport,
        command: normalized.command,
        url: normalized.url,
        args: JSON.stringify(normalized.args),
        env: JSON.stringify(normalized.env),
      },
    });

    invalidateMCPServer();

    await tryRecordAuditEvent({
      source: 'mcp',
      action: 'create_server',
      entityType: 'mcp_server',
      entityId: server.id,
      entityLabel: server.name,
      summary: `Created MCP server "${server.name}"`,
      severity: 'warning',
      details: {
        transport: server.transport,
        enabled: server.enabled,
      },
    });

    return NextResponse.json(server, { status: 201 });
  } catch (error) {
    console.error('mcp POST:', error);
    const message = error instanceof Error ? error.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      id: string;
      name?: string;
      transport?: string;
      command?: string;
      url?: string;
      args?: string[];
      env?: Record<string, string>;
      enabled?: boolean;
    };
    if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const current = await db.mCPServer.findUnique({ where: { id: body.id } });
    if (!current) {
      return NextResponse.json({ error: 'Server not found' }, { status: 404 });
    }

    const normalized = validateServerPayload({
      name: body.name ?? current.name,
      transport: body.transport ?? current.transport,
      command: body.command ?? current.command,
      url: body.url ?? current.url,
      args: body.args ?? JSON.parse(current.args || '[]'),
      env: body.env ?? JSON.parse(current.env || '{}'),
    });

    const server = await db.mCPServer.update({
      where: { id: body.id },
      data: {
        name: normalized.name,
        transport: normalized.transport,
        command: normalized.command,
        url: normalized.url,
        args: JSON.stringify(normalized.args),
        env: JSON.stringify(normalized.env),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      },
    });

    invalidateMCPServer(body.id);

    await tryRecordAuditEvent({
      source: 'mcp',
      action: 'update_server',
      entityType: 'mcp_server',
      entityId: server.id,
      entityLabel: server.name,
      summary: `Updated MCP server "${server.name}"`,
      severity: 'warning',
      details: {
        transport: server.transport,
        enabled: server.enabled,
      },
    });

    return NextResponse.json(server);
  } catch (error) {
    console.error('mcp PUT:', error);
    const message = error instanceof Error ? error.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const existing = await db.mCPServer.findUnique({ where: { id } });
    await db.mCPServer.delete({ where: { id } });
    invalidateMCPServer(id);

    await tryRecordAuditEvent({
      source: 'mcp',
      action: 'delete_server',
      entityType: 'mcp_server',
      entityId: id,
      entityLabel: existing?.name || id,
      summary: `Deleted MCP server "${existing?.name || id}"`,
      severity: 'warning',
      details: {},
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('mcp DELETE:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
