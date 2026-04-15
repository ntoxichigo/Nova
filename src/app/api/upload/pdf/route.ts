import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getEmbedding, encodeEmbedding } from '@/lib/embeddings';

// POST /api/upload/pdf — extract text from PDF, store each page as Knowledge
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const name = (file.name || 'document.pdf').replace(/[^a-zA-Z0-9._\- ]/g, '_');

    // Enforce 25 MB size limit
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: 'File exceeds 25 MB limit' }, { status: 413 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate PDF magic bytes (%PDF-)
    if (buffer.slice(0, 5).toString('ascii') !== '%PDF-') {
      return NextResponse.json({ error: 'File is not a valid PDF' }, { status: 400 });
    }

    // Dynamic import of pdf-parse (works in Node.js runtime)
    let pdfParse: (buf: Buffer) => Promise<{ numpages: number; text: string }>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      pdfParse = require('pdf-parse');
    } catch {
      return NextResponse.json({ error: 'pdf-parse not installed. Run: npm i pdf-parse' }, { status: 500 });
    }

    const data = await pdfParse(buffer);
    const text = data.text?.trim();
    if (!text) return NextResponse.json({ error: 'Could not extract text from PDF' }, { status: 400 });

    // Split into chunks of ~1500 chars at sentence boundaries
    const MAX_CHUNK = 1500;
    const chunks: string[] = [];
    const sentences = text.split(/(?<=[.!?])\s+/);
    let current = '';
    for (const sentence of sentences) {
      if (current.length + sentence.length > MAX_CHUNK && current.length > 0) {
        chunks.push(current.trim());
        current = '';
      }
      current += sentence + ' ';
    }
    if (current.trim()) chunks.push(current.trim());

    // Store each chunk as a Knowledge entry
    const created: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const topic = `${name} (chunk ${i + 1}/${chunks.length})`;
      const embeddingVec = await getEmbedding(`${topic}\n${chunks[i]}`);
      const entry = await db.knowledge.create({
        data: {
          topic,
          content: chunks[i],
          tags: JSON.stringify([name.replace('.pdf', ''), 'pdf-import']),
          source: 'pdf_upload',
          embedding: embeddingVec ? encodeEmbedding(embeddingVec) : null,
        },
      });
      created.push(entry.id);
    }

    return NextResponse.json({
      ok: true,
      filename: name,
      pages: data.numpages,
      chunks: chunks.length,
      totalChars: text.length,
      knowledgeIds: created,
    });
  } catch (e) {
    console.error('pdf upload:', e);
    return NextResponse.json({ error: 'PDF processing failed: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }
}
