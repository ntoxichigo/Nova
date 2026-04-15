import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// ── RSS Feeds CRUD + Fetch ──────────────────────────────────────────────────

// GET — list all RSS feeds
export async function GET() {
  const feeds = await db.rSSFeed.findMany({ orderBy: { updatedAt: 'desc' } });
  return NextResponse.json(feeds);
}

// POST — add new RSS feed
export async function POST(req: NextRequest) {
  const { name, url } = await req.json();
  if (!name || !url) return NextResponse.json({ error: 'name and url required' }, { status: 400 });

  try {
    new URL(url); // validate URL
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }

  const existing = await db.rSSFeed.findUnique({ where: { url } });
  if (existing) return NextResponse.json({ error: 'Feed URL already exists' }, { status: 409 });

  const feed = await db.rSSFeed.create({
    data: { name, url, enabled: true },
  });
  return NextResponse.json(feed, { status: 201 });
}

// PUT — update feed
export async function PUT(req: NextRequest) {
  const { id, name, url, enabled } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const feed = await db.rSSFeed.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(url !== undefined && { url }),
      ...(enabled !== undefined && { enabled }),
    },
  });
  return NextResponse.json(feed);
}

// DELETE — remove feed
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  await db.rSSFeed.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
