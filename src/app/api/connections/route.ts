import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { encryptToken } from '@/lib/crypto';
import { tryRecordAuditEvent } from '@/lib/audit';

export async function GET() {
  try {
    const connections = await db.connection.findMany({
      select: { id: true, service: true, scope: true, meta: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
    // Parse meta for display (never return raw tokens)
    return NextResponse.json(
      connections.map((c) => ({
        ...c,
        meta: (() => { try { return JSON.parse(c.meta); } catch { return {}; } })(),
      }))
    );
  } catch {
    return NextResponse.json({ error: 'Failed to fetch connections' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { service, accessToken, scope, meta } = await request.json();
    if (!service || !accessToken) {
      return NextResponse.json({ error: 'service and accessToken are required' }, { status: 400 });
    }
    const allowed = ['github', 'google'];
    if (!allowed.includes(service)) {
      return NextResponse.json({ error: `service must be one of: ${allowed.join(', ')}` }, { status: 400 });
    }

    // Validate the token by calling the service
    let metaObj: Record<string, string> = {};
    if (service === 'github') {
      const r = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'NovaAI' },
      });
      if (!r.ok) return NextResponse.json({ error: 'GitHub token validation failed — check the token and its scopes' }, { status: 400 });
      const u = await r.json();
      metaObj = { login: u.login, name: u.name || '', avatar: u.avatar_url || '', email: u.email || '' };
    } else if (service === 'google') {
      const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) return NextResponse.json({ error: 'Google token validation failed — check the token' }, { status: 400 });
      const u = await r.json();
      metaObj = { name: u.name || '', email: u.email || '', picture: u.picture || '' };
    }

    const conn = await db.connection.upsert({
      where: { service },
      update: { accessToken: encryptToken(accessToken), scope: scope || '', meta: JSON.stringify(metaObj), updatedAt: new Date() },
      create: { service, accessToken: encryptToken(accessToken), scope: scope || '', meta: JSON.stringify(metaObj) },
    });

    await tryRecordAuditEvent({
      source: 'connections',
      action: 'upsert',
      entityType: 'connection',
      entityId: conn.id,
      entityLabel: service,
      summary: `Connected ${service}`,
      details: {
        service,
        scope: scope || '',
        meta: metaObj,
      },
    });

    return NextResponse.json({ id: conn.id, service: conn.service, meta: metaObj }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save connection';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const service = searchParams.get('service');
    if (!service) return NextResponse.json({ error: 'service is required' }, { status: 400 });
    const existing = await db.connection.findUnique({ where: { service } });
    await db.connection.delete({ where: { service } });

    await tryRecordAuditEvent({
      source: 'connections',
      action: 'delete',
      entityType: 'connection',
      entityId: existing?.id,
      entityLabel: service,
      summary: `Disconnected ${service}`,
      details: { service },
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to remove connection' }, { status: 500 });
  }
}
