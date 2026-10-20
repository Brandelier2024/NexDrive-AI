import { GoogleGenAI } from "@google/genai";
import { config } from "@/lib/config";
import { createServerSupabaseClient } from "@/lib/supabase";
import { FolderCard, MatchedFile, OneDriveRecord } from "@/lib/types";
import {
  cosineSimilarity,
  getEmbedding,
  generateDeterministicVector,
} from "./embeddings";
import { isGeminiConfigured } from "@/lib/crawler/vision-describer";
import { getAllIndexedRecords } from "@/lib/crawler/indexer";

/**
 * Rewrites conversation history + latest message into a standalone query.
 * Resolves pronouns ("that campaign", "those reels", "the raw folder").
 */
export async function rewriteQuery(
  latestMessage: string,
  chatHistory?: Array<{ role: "user" | "assistant"; content: string }>
): Promise<string> {
  if (!chatHistory || chatHistory.length === 0 || !isGeminiConfigured()) {
    return latestMessage.trim();
  }

  try {
    const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    const formattedHistory = chatHistory
      .slice(-6)
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");

    const prompt = `Given the conversation history and the user's latest message, rewrite the latest message into a standalone search query for locating company OneDrive folders, images, or videos.
- Resolve all pronouns ("that campaign", "those reels", "the raw folder", "it", "them") using chat history.
- Preserve client names, project names, dates, media types (photo, video, raw, drone, logo, banner), and visual descriptions.
- Return ONLY the rewritten search query string without any other text or punctuation.

Chat History:
${formattedHistory}

Latest Message:
${latestMessage}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
    });

    const rewritten = response.text?.trim();
    return rewritten || latestMessage.trim();
  } catch (error) {
    console.warn("[Retriever] Query rewriting failed, using original message:", error);
    return latestMessage.trim();
  }
}

/**
 * Searches OneDrive records using vector similarity.
 * First tries Supabase pgvector RPC, falls back to in-memory cosine similarity.
 */
export async function searchOneDriveItems(
  query: string,
  topK: number = config.search.topK,
  threshold: number = config.search.similarityThreshold
): Promise<OneDriveRecord[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const matchedRecords: OneDriveRecord[] = [];
  const seenIds = new Set<string>();

  // 1. Try Supabase Hybrid Retrieval (Exact keyword + pgvector)
  try {
    const supabase = createServerSupabaseClient();

    // 1a. Text-based keyword search on company folder names & files
    const words = cleanQuery
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !["show", "find", "where", "what", "videos", "files", "folders"].includes(w));

    if (words.length > 0) {
      const orFilter = words
        .slice(0, 3)
        .map((w) => `name.ilike.%${w}%,folder_path.ilike.%${w}%,visual_tags.ilike.%${w}%`)
        .join(",");

      const { data: keywordMatches } = await supabase
        .from("onedrive_items")
        .select("*")
        .or(orFilter)
        .limit(topK);

      if (keywordMatches && keywordMatches.length > 0) {
        for (const item of keywordMatches) {
          if (!seenIds.has(item.item_id)) {
            seenIds.add(item.item_id);
            matchedRecords.push({ ...item, similarity: 0.95 });
          }
        }
      }
    }

    // 1b. Vector search via pgvector RPC
    const queryVector = generateDeterministicVector(cleanQuery, 768);
    const { data: vectorMatches, error } = await supabase.rpc("match_onedrive_items", {
      query_embedding: queryVector,
      match_threshold: 0.2,
      match_count: topK,
    });

    if (!error && vectorMatches && vectorMatches.length > 0) {
      for (const item of vectorMatches) {
        if (!seenIds.has(item.item_id)) {
          seenIds.add(item.item_id);
          matchedRecords.push(item as OneDriveRecord);
        }
      }
    }

    if (matchedRecords.length > 0) {
      return matchedRecords
        .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
        .slice(0, topK);
    }
  } catch (err) {
    console.warn("[Retriever] Supabase search error, trying fallback:", err);
  }

  // 2. In-memory / Fallback Vector Search
  const queryEmbedding = await getEmbedding(cleanQuery);
  const allRecords = await getAllIndexedRecords();
  const scored = allRecords
    .map((record) => {
      let sim = 0;
      if (record.embedding && record.embedding.length > 0) {
        sim = cosineSimilarity(queryEmbedding, record.embedding);
      } else {
        const queryTerms = cleanQuery.toLowerCase().split(/\s+/).filter(Boolean);
        const text = `${record.folder_path} ${record.name} ${record.visual_summary || ""} ${record.visual_tags || ""}`.toLowerCase();
        const matches = queryTerms.filter((term) => text.includes(term)).length;
        sim = queryTerms.length > 0 ? (matches / queryTerms.length) * 0.8 : 0;
      }
      return { ...record, similarity: sim };
    })
    .filter((r) => r.similarity >= threshold)
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));

  return scored.slice(0, topK);
}

/**
 * Group matched items by Parent OneDrive Folder (Folder-First Presentation)
 */
export function groupItemsByFolder(matchedItems: OneDriveRecord[]): FolderCard[] {
  const folderMap = new Map<string, FolderCard>();

  for (const item of matchedItems) {
    const folderKey = item.folder_web_url;
    if (!folderKey) continue;

    let card = folderMap.get(folderKey);
    if (!card) {
      card = {
        parent_folder_id: item.parent_folder_id ?? undefined,
        parent_folder_name: item.parent_folder_name || (item.record_type === "folder" ? item.name : "Parent Folder"),
        folder_path: item.folder_path,
        folder_web_url: item.folder_web_url,
        thumbnail_url: item.thumbnail_url ?? undefined,
        highest_similarity: item.similarity ?? 0,
        matched_files: [],
      };
      folderMap.set(folderKey, card);
    }

    // Update highest similarity
    if ((item.similarity ?? 0) > (card.highest_similarity ?? 0)) {
      card.highest_similarity = item.similarity ?? 0;
    }

    // If it's a media file, add to matched_files
    if (item.record_type !== "folder" && item.file_web_url) {
      const matchedFile: MatchedFile = {
        item_id: item.item_id,
        name: item.name,
        file_web_url: item.file_web_url,
        record_type: item.record_type,
        media_type: item.media_type ?? undefined,
        thumbnail_url: item.thumbnail_url ?? undefined,
        visual_summary: item.visual_summary ?? undefined,
        visual_tags: item.visual_tags ?? undefined,
        similarity: item.similarity,
      };

      // Deduplicate file
      if (!card.matched_files.some((f) => f.item_id === item.item_id)) {
        card.matched_files.push(matchedFile);
      }

      // If card doesn't have a thumbnail, use the file's thumbnail
      if (!card.thumbnail_url && item.thumbnail_url) {
        card.thumbnail_url = item.thumbnail_url;
      }
    }
  }

  // Sort folder cards by highest similarity
  return Array.from(folderMap.values()).sort(
    (a, b) => (b.highest_similarity ?? 0) - (a.highest_similarity ?? 0)
  );
}
