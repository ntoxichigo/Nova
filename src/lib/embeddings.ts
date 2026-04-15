/**
 * Embedding utilities using Ollama's /api/embed endpoint.
 * Falls back gracefully when Ollama is not running.
 */

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

export async function getEmbedding(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: text }),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Ollama returns { embeddings: [[...]] }
    return data.embeddings?.[0] ?? null;
  } catch {
    return null;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function encodeEmbedding(embedding: number[]): string {
  return JSON.stringify(embedding);
}

export function decodeEmbedding(stored: string): number[] | null {
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

/**
 * Score knowledge entries by semantic similarity to query embedding.
 * Falls back to keyword matching if embeddings are unavailable.
 */
export async function rankByRelevance<T extends { topic: string; content: string; embedding?: string | null }>(
  items: T[],
  query: string,
  topK = 5
): Promise<T[]> {
  const queryEmbed = await getEmbedding(query);

  if (!queryEmbed) {
    // Fallback: keyword relevance
    const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    return items
      .filter((item) =>
        words.some((w) => item.topic.toLowerCase().includes(w) || item.content.toLowerCase().includes(w))
      )
      .slice(0, topK);
  }

  const scored = items.map((item) => {
    let score = 0;
    if (item.embedding) {
      const vec = decodeEmbedding(item.embedding);
      if (vec) score = cosineSimilarity(queryEmbed, vec);
    }
    return { item, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .filter((s) => s.score > 0.3)
    .slice(0, topK)
    .map((s) => s.item);
}
