import { FolderCard } from "@/lib/types";
import { getEmbedding } from "@/lib/retrieval/embeddings";
import { parseTemporalIntent } from "@/lib/retrieval/retriever";

export interface SemanticCacheEntry {
  query: string;
  embedding: number[];
  folderCards: FolderCard[];
  answerMarkdown: string;
  scope: string;
  userEmail?: string;
  mediaType: "folder" | "video" | "image" | "any";
  createdAt: number;
}

// In-memory sliding-window semantic cache preserved across module reloads
const globalForSemanticCache = globalThis as unknown as {
  __semanticCache?: SemanticCacheEntry[];
  __semanticCacheStats?: { hits: number; misses: number };
};

const cacheStore: SemanticCacheEntry[] = globalForSemanticCache.__semanticCache ?? [];
if (!globalForSemanticCache.__semanticCache) {
  globalForSemanticCache.__semanticCache = cacheStore;
}

const stats = globalForSemanticCache.__semanticCacheStats ?? { hits: 0, misses: 0 };
if (!globalForSemanticCache.__semanticCacheStats) {
  globalForSemanticCache.__semanticCacheStats = stats;
}

// shortcut: In-memory sliding window cache. For distributed multi-worker scaling, upgrade to Redis or pgvector cache table.
const MAX_CACHE_ENTRIES = 500;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_SIMILARITY_THRESHOLD = 0.92;

/**
 * Computes cosine similarity between two normalized or unnormalized float vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function pruneExpiredEntries(now: number): void {
  for (let i = cacheStore.length - 1; i >= 0; i--) {
    if (now - cacheStore[i].createdAt > CACHE_TTL_MS) {
      cacheStore.splice(i, 1);
    }
  }
}

/**
 * Retrieves cached RAG response for a query based on exact match or semantic vector similarity.
 * Enforces strict scope and user email isolation.
 */
export async function getCachedResponse(
  query: string,
  scope: string,
  userEmail?: string
): Promise<{ folderCards: FolderCard[]; answerMarkdown: string; similarity: number } | null> {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) return null;

  try {
    const now = Date.now();
    pruneExpiredEntries(now);

    const normalizedUser = userEmail ? userEmail.trim().toLowerCase() : undefined;
    const temporal = parseTemporalIntent(cleanQuery);
    const targetMediaType = temporal.mediaType || "any";

    // 1. Fast Path: Exact normalized string match (0ms)
    for (let i = cacheStore.length - 1; i >= 0; i--) {
      const entry = cacheStore[i];
      if (now - entry.createdAt > CACHE_TTL_MS) continue;
      if (entry.scope !== scope) continue;
      if (scope === "personal" && entry.userEmail !== normalizedUser) continue;
      if (entry.mediaType !== targetMediaType) continue;

      if (entry.query === cleanQuery) {
        stats.hits++;
        return {
          folderCards: entry.folderCards,
          answerMarkdown: entry.answerMarkdown,
          similarity: 1.0,
        };
      }
    }

    // 2. Semantic Path: Embedding Cosine Similarity
    const queryEmbedding = await getEmbedding(cleanQuery);
    if (!queryEmbedding || queryEmbedding.length === 0) {
      stats.misses++;
      return null;
    }

    const threshold =
      parseFloat(process.env.SEMANTIC_CACHE_THRESHOLD || "") || DEFAULT_SIMILARITY_THRESHOLD;
    let bestMatch: SemanticCacheEntry | null = null;
    let highestSim = -1;

    for (let i = cacheStore.length - 1; i >= 0; i--) {
      const entry = cacheStore[i];
      if (now - entry.createdAt > CACHE_TTL_MS) continue;
      if (entry.scope !== scope) continue;
      if (scope === "personal" && entry.userEmail !== normalizedUser) continue;
      if (entry.mediaType !== targetMediaType) continue;

      const sim = cosineSimilarity(queryEmbedding, entry.embedding);
      if (sim >= threshold && sim > highestSim) {
        highestSim = sim;
        bestMatch = entry;
      }
    }

    if (bestMatch) {
      stats.hits++;
      return {
        folderCards: bestMatch.folderCards,
        answerMarkdown: bestMatch.answerMarkdown,
        similarity: highestSim,
      };
    }

    stats.misses++;
    return null;
  } catch (error) {
    console.warn("[Semantic Cache] Lookup error, falling back to live retrieval:", error);
    stats.misses++;
    return null;
  }
}

/**
 * Stores a RAG query result in the semantic cache.
 */
export async function setCachedResponse(
  query: string,
  scope: string,
  folderCards: FolderCard[],
  answerMarkdown: string,
  userEmail?: string,
  embedding?: number[]
): Promise<void> {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery || folderCards.length === 0) return;

  try {
    const emb =
      embedding && embedding.length > 0 ? embedding : await getEmbedding(cleanQuery);
    const temporal = parseTemporalIntent(cleanQuery);
    const normalizedUser = userEmail ? userEmail.trim().toLowerCase() : undefined;

    const now = Date.now();
    pruneExpiredEntries(now);

    if (cacheStore.length >= MAX_CACHE_ENTRIES) {
      cacheStore.splice(0, Math.floor(MAX_CACHE_ENTRIES / 5)); // Evict oldest 20%
    }

    cacheStore.push({
      query: cleanQuery,
      embedding: emb,
      folderCards,
      answerMarkdown,
      scope,
      userEmail: normalizedUser,
      mediaType: temporal.mediaType || "any",
      createdAt: now,
    });
  } catch (error) {
    console.warn("[Semantic Cache] Store error:", error);
  }
}

export function clearSemanticCache(): void {
  cacheStore.length = 0;
  stats.hits = 0;
  stats.misses = 0;
}

export function getSemanticCacheStats(): { size: number; hits: number; misses: number } {
  return {
    size: cacheStore.length,
    hits: stats.hits,
    misses: stats.misses,
  };
}

