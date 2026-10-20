import { GoogleGenAI } from "@google/genai";
import { config } from "@/lib/config";
import { isGeminiConfigured } from "@/lib/crawler/vision-describer";
import { OneDriveRecord } from "@/lib/types";

const EMBEDDING_DIMENSION = 768;

/**
 * Creates the standard rich text representation for vector embedding:
 * [Folder Path + Folder Name + File Name + Visual Summary + Tags]
 */
export function buildEmbeddingInputText(record: OneDriveRecord): string {
  const parts = [
    `Path: ${record.folder_path}`,
    `Folder: ${record.parent_folder_name || record.name}`,
    `Name: ${record.name}`,
    `Type: ${record.record_type}`,
  ];

  if (record.visual_summary) {
    parts.push(`Summary: ${record.visual_summary}`);
  }

  if (record.visual_tags) {
    parts.push(`Tags: ${record.visual_tags}`);
  }

  return parts.join(" | ");
}

/**
 * Computes vector embedding using Google Gemini Embeddings API.
 * Returns 768-dimensional float array.
 * If Gemini is unconfigured or fails, returns a deterministic normalized hash vector.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  if (isGeminiConfigured()) {
    try {
      const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
      const modelName = config.gemini.embeddingModel.replace("models/", "") || "text-embedding-004";

      const response = await ai.models.embedContent({
        model: modelName,
        contents: text,
      });

      const embValues =
        response.embeddings?.[0]?.values || (response as any).embedding?.values;

      if (embValues && embValues.length > 0) {
        // Ensure standard 768 dimensions
        if (embValues.length >= EMBEDDING_DIMENSION) {
          return embValues.slice(0, EMBEDDING_DIMENSION);
        }
        // Pad if necessary
        const padded = new Array(EMBEDDING_DIMENSION).fill(0);
        for (let i = 0; i < embValues.length; i++) padded[i] = embValues[i];
        return padded;
      }
    } catch (error) {
      console.warn("[Embeddings] Gemini API embedding failed, using local hash vector fallback:", error);
    }
  }

  // Deterministic local embedding fallback for offline / mock testing
  return generateDeterministicVector(text, EMBEDDING_DIMENSION);
}

/**
 * Generates a deterministic normalized pseudo-vector based on word hashes.
 * Ensures cosine similarity correlates with word overlap for offline testing.
 */
export function generateDeterministicVector(text: string, dimensions: number): number[] {
  const vector = new Array(dimensions).fill(0);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = (hash << 5) - hash + word.charCodeAt(i);
      hash |= 0;
    }
    const idx = Math.abs(hash) % dimensions;
    vector[idx] += 1.0;

    // Cross-dimension distribution for semantic smoothing
    const secondaryIdx = Math.abs((hash * 31) + 17) % dimensions;
    vector[secondaryIdx] += 0.5;
  }

  // L2 normalize
  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);

  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) {
      vector[i] /= norm;
    }
  } else {
    // Non-zero fallback
    vector[0] = 1.0;
  }

  return vector;
}

/**
 * Helper to compute cosine similarity between two float vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
