import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// POST /api/rss/feeds/fetch — fetch all enabled RSS feeds and import new items as Knowledge
export async function POST(_req: NextRequest) {
  const feeds = await db.rSSFeed.findMany({ where: { enabled: true } });
  const results: Array<{ feed: string; newItems: number; error?: string }> = [];

  for (const feed of feeds) {
    try {
      const res = await fetch(feed.url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const xml = await res.text();
      const items = parseRSSItems(xml);

      let newCount = 0;
      for (const item of items) {
        // Check if we already have this item (by title + source)
        const exists = await db.knowledge.findFirst({
          where: { topic: item.title, source: `rss:${feed.id}` },
        });
        if (exists) continue;

        const content = [
          item.title,
          item.link ? `Link: ${item.link}` : '',
          item.pubDate ? `Published: ${item.pubDate}` : '',
          '',
          item.description || '',
        ]
          .filter(Boolean)
          .join('\n');

        await db.knowledge.create({
          data: {
            topic: item.title.slice(0, 200),
            content,
            tags: JSON.stringify([feed.name, 'rss-import']),
            source: `rss:${feed.id}`,
          },
        });
        newCount++;
      }

      // Update feed metadata
      await db.rSSFeed.update({
        where: { id: feed.id },
        data: {
          lastFetchAt: new Date(),
          itemCount: await db.knowledge.count({ where: { source: `rss:${feed.id}` } }),
        },
      });

      results.push({ feed: feed.name, newItems: newCount });
    } catch (e) {
      results.push({ feed: feed.name, newItems: 0, error: String(e) });
    }
  }

  return NextResponse.json({ results, fetchedAt: new Date().toISOString() });
}

// ── Simple RSS/Atom XML parser (no external dependency) ──────────────────────

interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

function parseRSSItems(xml: string): RSSItem[] {
  const items: RSSItem[] = [];

  // Try RSS 2.0 <item> tags first
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    items.push(parseItemFields(match[1]));
  }

  // If no items, try Atom <entry> tags
  if (items.length === 0) {
    const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
    while ((match = entryRegex.exec(xml)) !== null) {
      const fields = parseItemFields(match[1]);
      // Atom uses <link href="..."/> instead of <link>...</link>
      if (!fields.link) {
        const linkMatch = match[1].match(/<link[^>]*href=["']([^"']+)["']/i);
        if (linkMatch) fields.link = linkMatch[1];
      }
      // Atom uses <published> or <updated> instead of <pubDate>
      if (!fields.pubDate) {
        const pubMatch = match[1].match(/<(?:published|updated)>([\s\S]*?)<\/(?:published|updated)>/i);
        if (pubMatch) fields.pubDate = pubMatch[1].trim();
      }
      // Atom uses <summary> or <content> instead of <description>
      if (!fields.description) {
        const descMatch = match[1].match(/<(?:summary|content)[^>]*>([\s\S]*?)<\/(?:summary|content)>/i);
        if (descMatch) fields.description = stripHTML(descMatch[1].trim());
      }
      items.push(fields);
    }
  }

  return items.slice(0, 50); // cap at 50 items per feed
}

function parseItemFields(block: string): RSSItem {
  const get = (tag: string) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m ? stripHTML(m[1].trim()) : '';
  };

  return {
    title: get('title') || 'Untitled',
    link: get('link'),
    description: get('description'),
    pubDate: get('pubDate'),
  };
}

function stripHTML(html: string): string {
  return html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
