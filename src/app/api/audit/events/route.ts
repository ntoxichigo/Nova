import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { parseAuditDetails } from '@/lib/audit';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const source = searchParams.get('source')?.trim();
    const status = searchParams.get('status')?.trim();
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 50));

    const events = await db.auditEvent.findMany({
      where: {
        ...(source ? { source } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return NextResponse.json(
      events.map((event) => ({
        ...event,
        details: parseAuditDetails(event.details),
      })),
    );
  } catch (error) {
    console.error('audit events GET:', error);
    return NextResponse.json({ error: 'Failed to fetch audit events' }, { status: 500 });
  }
}
