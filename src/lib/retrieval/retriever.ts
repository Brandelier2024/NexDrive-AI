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
import { getActiveGeminiKey } from "@/lib/llm/multi-provider";

const PRONOUN_REGEX = /\b(that|those|it|them|this|the folder|the files|the video|the photo|the previous|inside|more|other)\b/i;

/**
 * Rewrites conversation history + latest message into a standalone query.
 * Only resolves when user message actually contains pronouns ("that campaign", "those reels", "the raw folder").
 */
export async function rewriteQuery(
  latestMessage: string,
  chatHistory?: Array<{ role: "user" | "assistant"; content: string }>
): Promise<string> {
  const trimmed = latestMessage.trim();
  // If no chat history, or message does not contain conversational references, skip LLM call
  if (!chatHistory || chatHistory.length === 0 || !isGeminiConfigured() || !PRONOUN_REGEX.test(trimmed) || trimmed.length < 3) {
    return trimmed;
  }

  try {
    const apiKey = getActiveGeminiKey() || config.gemini.apiKey;
    const ai = new GoogleGenAI({ apiKey });
    const formattedHistory = chatHistory
      .slice(-4)
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");

    const prompt = `Given the conversation history and the user's latest message, rewrite the latest message into a standalone search query for locating company OneDrive folders, images, or videos.
- Resolve all pronouns ("that campaign", "those reels", "the raw folder", "it", "them") using chat history.
- Preserve client names, project names, dates, media types (photo, video, raw, drone, logo, banner), and visual descriptions.
- Return ONLY the rewritten search query string without any other text or punctuation.

Chat History:
${formattedHistory}

Latest Message:
${trimmed}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
    });

    const rewritten = response.text?.trim();
    return rewritten || trimmed;
  } catch (error) {
    console.warn("[Retriever] Query rewriting failed, using original message:", error);
    return trimmed;
  }
}

export const STOP_WORDS = new Set([
  "a", "about", "all", "an", "and", "any", "are", "as", "at", "be", "been", "being", 
  "by", "can", "could", "did", "do", "does", "for", "from", 
  "had", "has", "have", "here", "how", "i", "in", "is", "it", "item", "items", 
  "like", "locate", "locating", "look", "looking", "me", "media", "my", 
  "name", "named", "names", "need", "needs", "needed", "of", "off", 
  "on", "one", "onto", "open", "opening", "or", "our", "please", 
  "search", "searching", "show", "showing", "tell", "that", "the", 
  "their", "them", "then", "there", "these", "they", "this", "those", "to", "us", 
  "want", "wanted", "wants", "was", "we", "were", "what", "where", "which", 
  "who", "why", "will", "with", "would", "you", "your",
  "give", "get", "getting", "find", "finding", "list", "listing",
  "upload", "uploaded", "uploading", "uploads",
  "create", "created", "creating", "creates",
  "add", "added", "adding", "adds",
  "modify", "modified", "modifying",
  "update", "updated", "updating",
  "save", "saved", "saving",
  "store", "stored", "storing",
  "put", "bring", "fetch", "fetching",
  "file", "files", "fiel", "fiels", "flie", "flies", "filename", "filenames",
  "folder", "folders", "foler", "folers", "floder", "floders", "directory", "directories"
]);

export const MONTH_MAP: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

export const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december"
];

export const MONTH_SHORTS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec"
];

export interface TemporalIntent {
  isTemporal: boolean;
  monthNum?: number;
  monthName?: string;
  monthShort?: string;
  year?: number;
  isRecent?: boolean;
  mediaType?: "folder" | "video" | "image";
  remainingKeywords: string[];
}

/**
 * Parses user query for temporal/date expressions, months, years, and media filters.
 */
export function parseTemporalIntent(query: string): TemporalIntent {
  const lower = query.toLowerCase();

  let mediaType: "folder" | "video" | "image" | undefined;
  if (/\b(video|videos|mp4|mov|footage|clip|clips|reel|reels)\b/.test(lower)) {
    mediaType = "video";
  } else if (/\b(photo|photos|image|images|picture|pictures|pic|pics|jpg|jpeg|png)\b/.test(lower)) {
    mediaType = "image";
  } else if (/\b(folder|folders|directory|directories)\b/.test(lower)) {
    mediaType = "folder";
  }

  let year: number | undefined;
  const yearMatch = lower.match(/\b(202[0-9])\b/);
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
  }

  let monthNum: number | undefined;
  let monthName: string | undefined;
  let monthShort: string | undefined;

  for (const [key, num] of Object.entries(MONTH_MAP)) {
    const rx = new RegExp(`\\b${key}\\b`, "i");
    if (rx.test(lower)) {
      monthNum = num;
      monthName = MONTH_NAMES[num - 1];
      monthShort = MONTH_SHORTS[num - 1];
      break;
    }
  }

  const isRecent = /\b(recent|recently|latest|newest|today|yesterday|this week|last week|this month)\b/i.test(lower);

  const rawKeywords = extractKeywords(query);
  const remainingKeywords = rawKeywords.filter((w) => {
    if (year && w === String(year)) return false;
    if (monthName && (w === monthName || w === monthShort)) return false;
    if (w === "recent" || w === "recently" || w === "latest" || w === "newest") return false;
    if (mediaType && (w === "video" || w === "videos" || w === "image" || w === "images" || w === "photo" || w === "photos")) return false;
    return true;
  });

  return {
    isTemporal: !!monthNum || isRecent || !!year,
    monthNum,
    monthName,
    monthShort,
    year,
    isRecent,
    mediaType,
    remainingKeywords,
  };
}

/**
 * Extracts key subject words from user query, stripping filler and stop words
 */
export function extractKeywords(query: string): string[] {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return words;
}

/**
 * Generates common transliteration and spelling variations (e.g. v <-> w, sh <-> s, ee <-> i)
 */
export function getSpellingVariants(word: string): string[] {
  const clean = word.toLowerCase().trim();
  if (clean.length < 3) return [clean];

  const variants = new Set<string>([clean]);

  // 1. Swap 'v' and 'w' (e.g. aishvarya <-> aishwarya, vikas <-> wikas)
  if (clean.includes("v")) variants.add(clean.replace(/v/g, "w"));
  if (clean.includes("w")) variants.add(clean.replace(/w/g, "v"));

  // 2. 'sh' <-> 's' (e.g. ashish <-> asis, shakti <-> sakti)
  if (clean.includes("sh")) variants.add(clean.replace(/sh/g, "s"));
  if (clean.includes("s") && !clean.includes("sh")) variants.add(clean.replace(/s/g, "sh"));

  // 3. 'ee' <-> 'i' (e.g. deepak <-> dipak, praveen <-> pravin)
  if (clean.includes("ee")) variants.add(clean.replace(/ee/g, "i"));
  if (clean.includes("i")) variants.add(clean.replace(/i/g, "ee"));

  // 4. 'oo' <-> 'u' (e.g. pooja <-> puja)
  if (clean.includes("oo")) variants.add(clean.replace(/oo/g, "u"));
  if (clean.includes("u")) variants.add(clean.replace(/u/g, "oo"));

  // 5. 'c' <-> 'k' (e.g. kale <-> cale)
  if (clean.includes("c")) variants.add(clean.replace(/c/g, "k"));
  if (clean.includes("k")) variants.add(clean.replace(/k/g, "c"));

  // 6. 'ya' <-> 'ia' (e.g. aishwarya <-> aishwaria)
  if (clean.endsWith("ya")) variants.add(clean.replace(/ya$/, "ia"));
  if (clean.endsWith("ia")) variants.add(clean.replace(/ia$/, "ya"));

  // 7. Double 'aa' <-> 'a'
  if (clean.includes("aa")) variants.add(clean.replace(/aa/g, "a"));

  return Array.from(variants);
}

/**
 * Searches OneDrive records using targeted Supabase full-text, temporal dates, and phonetic pattern matching.
 * Returns exact verified records with high fidelity and zero hallucinations.
 */
export async function searchOneDriveItems(
  query: string,
  topK: number = config.search.topK
): Promise<OneDriveRecord[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const matchedRecords: OneDriveRecord[] = [];
  const seenIds = new Set<string>();

  try {
    const supabase = createServerSupabaseClient();

    // ────────────────────────────────────────────────────────
    // Branch 1: Temporal / Date / Month Intent (e.g. "files uploaded in october", "recent uploads")
    // ────────────────────────────────────────────────────────
    const temporal = parseTemporalIntent(cleanQuery);
    if (temporal.isTemporal) {
      if (temporal.monthNum) {
        const targetYears = temporal.year ? [temporal.year] : [2026, 2025];

        // 1a. Folders with month in name or path
        let folderQuery = supabase
          .from("onedrive_items")
          .select("*")
          .eq("record_type", "folder")
          .neq("name", "root")
          .or(`name.ilike.%${temporal.monthName}%,folder_path.ilike.%${temporal.monthName}%,name.ilike.%${temporal.monthShort}%,folder_path.ilike.%${temporal.monthShort}%`);

        for (const kw of temporal.remainingKeywords) {
          folderQuery = folderQuery.or(`name.ilike.%${kw}%,folder_path.ilike.%${kw}%`);
        }

        const { data: matchedFolders } = await folderQuery.limit(5);
        if (matchedFolders) {
          for (const f of matchedFolders) {
            if (!seenIds.has(f.item_id)) {
              seenIds.add(f.item_id);
              matchedRecords.push({ ...f, similarity: 0.95 });
            }
          }
        }

        // 1b. Items where last_modified is in target month
        for (const y of targetYears) {
          const padM = String(temporal.monthNum).padStart(2, "0");
          const nextY = temporal.monthNum === 12 ? y + 1 : y;
          const nextM = temporal.monthNum === 12 ? 1 : temporal.monthNum + 1;
          const padNextM = String(nextM).padStart(2, "0");

          const startIso = `${y}-${padM}-01T00:00:00Z`;
          const endIso = `${nextY}-${padNextM}-01T00:00:00Z`;

          let dateQuery = supabase
            .from("onedrive_items")
            .select("*")
            .neq("name", "root")
            .gte("last_modified", startIso)
            .lt("last_modified", endIso);

          if (temporal.mediaType) {
            dateQuery = dateQuery.eq("record_type", temporal.mediaType);
          }

          for (const kw of temporal.remainingKeywords) {
            dateQuery = dateQuery.or(`name.ilike.%${kw}%,folder_path.ilike.%${kw}%`);
          }

          const { data: dateMatches } = await dateQuery
            .order("last_modified", { ascending: false })
            .limit(6);

          if (dateMatches) {
            for (const item of dateMatches) {
              if (!seenIds.has(item.item_id)) {
                seenIds.add(item.item_id);
                matchedRecords.push({ ...item, similarity: 0.92 });
              }
            }
          }
        }
      } else if (temporal.isRecent) {
        // Query recent items
        let recentQuery = supabase
          .from("onedrive_items")
          .select("*")
          .neq("name", "root");

        if (temporal.mediaType) {
          recentQuery = recentQuery.eq("record_type", temporal.mediaType);
        }

        for (const kw of temporal.remainingKeywords) {
          recentQuery = recentQuery.or(`name.ilike.%${kw}%,folder_path.ilike.%${kw}%`);
        }

        const { data: recentItems } = await recentQuery
          .order("last_modified", { ascending: false })
          .limit(topK);

        if (recentItems) {
          for (const item of recentItems) {
            if (!seenIds.has(item.item_id)) {
              seenIds.add(item.item_id);
              matchedRecords.push({ ...item, similarity: 0.93 });
            }
          }
        }
      }

      // Child expansion for matched folders in temporal search
      if (matchedRecords.length > 0) {
        const foldersFound = matchedRecords.filter((r) => r.record_type === "folder");
        for (const folder of foldersFound) {
          let childQuery = supabase
            .from("onedrive_items")
            .select("*")
            .or(`parent_folder_id.eq.${folder.item_id},folder_path.ilike.${folder.folder_path}/%`)
            .neq("record_type", "folder");

          if (temporal.mediaType) {
            childQuery = childQuery.eq("record_type", temporal.mediaType);
          }

          const { data: children } = await childQuery.limit(5);
          if (children) {
            for (const child of children) {
              if (!seenIds.has(child.item_id)) {
                seenIds.add(child.item_id);
                matchedRecords.push({ ...child, similarity: 0.90 });
              }
            }
          }
        }

        return matchedRecords
          .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
          .slice(0, topK * 2);
      }
    }

    // ────────────────────────────────────────────────────────
    // Branch 2: Standard Entity / Brand / File Keyword Search
    // ────────────────────────────────────────────────────────
    let keywords = extractKeywords(cleanQuery);
    // If multiple keywords exist, ignore short pure numbers (e.g. "123", "01") that cause false matches
    if (keywords.length > 1) {
      keywords = keywords.filter((k) => isNaN(Number(k)) || k.length >= 4);
    }

    if (keywords.length === 0) {
      keywords = cleanQuery
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && (isNaN(Number(w)) || w.length >= 4));
    }

    if (keywords.length === 0) {
      return [];
    }

    // Multi-word phrase matching (e.g. "sula wine masterclass", "team files", "shakti kale")
    if (keywords.length >= 2) {
      const phrase = keywords.join("%");
      const { data: phraseMatches } = await supabase
        .from("onedrive_items")
        .select("*")
        .neq("name", "root")
        .or(`name.ilike.%${phrase}%,folder_path.ilike.%${phrase}%`)
        .limit(topK);

      if (phraseMatches && phraseMatches.length > 0) {
        for (const item of phraseMatches) {
          if (!seenIds.has(item.item_id)) {
            seenIds.add(item.item_id);
            matchedRecords.push({ ...item, similarity: 0.98 });
          }
        }
      }
    }

    // Multi-word AND search if phrase match found no results
    if (keywords.length >= 2 && matchedRecords.length < topK) {
      let queryBuilder = supabase
        .from("onedrive_items")
        .select("*")
        .neq("name", "root");

      for (const kw of keywords) {
        const variants = getSpellingVariants(kw);
        const orForKw = variants.map((v) => `name.ilike.%${v}%,folder_path.ilike.%${v}%`).join(",");
        queryBuilder = queryBuilder.or(orForKw);
      }

      const { data: andMatches } = await queryBuilder.limit(topK);
      if (andMatches) {
        for (const item of andMatches) {
          if (!seenIds.has(item.item_id)) {
            seenIds.add(item.item_id);
            matchedRecords.push({ ...item, similarity: 0.95 });
          }
        }
      }
    }

    // Single-word search (only if 1 keyword or specific code)
    if (keywords.length === 1 && matchedRecords.length === 0) {
      const variants = getSpellingVariants(keywords[0]);
      const orFilter = variants
        .map((t) => `name.ilike.%${t}%,folder_path.ilike.%${t}%`)
        .join(",");

      const { data: termMatches } = await supabase
        .from("onedrive_items")
        .select("*")
        .neq("name", "root")
        .or(orFilter)
        .limit(topK);

      if (termMatches) {
        for (const item of termMatches) {
          if (!seenIds.has(item.item_id)) {
            seenIds.add(item.item_id);
            matchedRecords.push({ ...item, similarity: 0.92 });
          }
        }
      }
    }

    // Child expansion ONLY on legitimately matched folders
    if (matchedRecords.length > 0) {
      const foldersFound = matchedRecords.filter((r) => r.record_type === "folder");
      for (const folder of foldersFound) {
        const { data: children } = await supabase
          .from("onedrive_items")
          .select("*")
          .or(`parent_folder_id.eq.${folder.item_id},folder_path.ilike.${folder.folder_path}/%`)
          .neq("record_type", "folder")
          .limit(6);

        if (children && children.length > 0) {
          for (const child of children) {
            if (!seenIds.has(child.item_id)) {
              seenIds.add(child.item_id);
              matchedRecords.push({ ...child, similarity: 0.90 });
            }
          }
        }
      }
    }

    if (matchedRecords.length > 0) {
      return matchedRecords
        .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
        .slice(0, topK * 2);
    }
  } catch (err) {
    console.warn("[Retriever] Supabase search error:", err);
  }

  // If no items legitimately matched, return EMPTY array.
  // Never hallucinate records or fallback to random items!
  return [];
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
        is_personal: item.is_personal,
        drive_scope: item.drive_scope,
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
        is_personal: item.is_personal,
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
