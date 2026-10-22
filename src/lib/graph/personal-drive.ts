import { getGraphAccessToken } from "./auth";
import { OneDriveRecord, RecordType } from "@/lib/types";
import { STOP_WORDS } from "@/lib/retrieval/retriever";

interface GraphDriveItem {
  id: string;
  name: string;
  webUrl: string;
  folder?: {
    childCount?: number;
  };
  file?: {
    mimeType?: string;
  };
  image?: {
    width?: number;
    height?: number;
  };
  video?: {
    duration?: number;
    width?: number;
    height?: number;
  };
  parentReference?: {
    id?: string;
    path?: string;
    driveId?: string;
    name?: string;
  };
  lastModifiedDateTime?: string;
}

// In-memory cache for user personal drive items (3 minute TTL)
interface CacheEntry {
  items: GraphDriveItem[];
  timestamp: number;
}
const userDriveCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

// Tracks in-progress pagination cursor for drives exceeding initial maxPages
// so subsequent searches continue from the nextUrl rather than refetching the same capped pages.
interface IncompletePaginationState {
  items: GraphDriveItem[];
  nextUrl: string;
  pageCount: number;
  timestamp: number;
}
const pendingDrivePagination = new Map<string, IncompletePaginationState>();

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "heic", "raw"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "avi", "mkv", "wmv", "m4v", "webm"]);

function determineType(item: GraphDriveItem): RecordType | null {
  if (item.folder) return "folder";
  const ext = item.name.split(".").pop()?.toLowerCase() || "";
  if (item.video || VIDEO_EXTENSIONS.has(ext)) return "video";
  if (item.image || IMAGE_EXTENSIONS.has(ext)) return "image";
  return null;
}

function cleanParentPath(rawPath?: string): string {
  if (!rawPath) return "My OneDrive";
  const cleaned = rawPath
    .replace(/^\/drives\/[^/]+\/root:?/, "")
    .replace(/^\/drive\/root:?/, "")
    .replace(/^:+/, "")
    .replace(/^\/+/, "");
  return cleaned || "My OneDrive";
}

/**
 * Derives parent folder webUrl directly from item.webUrl without hardcoded tenant URLs
 */
function getFolderWebUrl(item: GraphDriveItem, isFolder: boolean): string {
  if (isFolder || !item.webUrl) {
    return item.webUrl || "";
  }

  // Derive parent folder directly from the file's webUrl by removing the final file segment
  const lastSlashIndex = item.webUrl.lastIndexOf("/");
  if (lastSlashIndex > 0) {
    return item.webUrl.substring(0, lastSlashIndex);
  }

  return item.webUrl;
}

export const SHARED_DATA_STORAGE_ACCOUNTS = [
  "data.brandelier@brandelier.in",
  "data.brandelier2@brandelier.in",
] as const;

export function isSharedDataStorageAccount(email: string): boolean {
  const norm = email.toLowerCase().trim();
  return SHARED_DATA_STORAGE_ACCOUNTS.some((acc) => acc.toLowerCase() === norm);
}

/**
 * Fetches all items from an employee's personal OneDrive or corporate data storage account via Microsoft Graph /delta
 * with automatic pagination, request timeout, and cache eviction.
 */
async function fetchUserDriveItems(userEmail: string): Promise<GraphDriveItem[]> {
  const normalizedEmail = userEmail.toLowerCase().trim();
  const cached = userDriveCache.get(normalizedEmail);
  const now = Date.now();
  const isSharedStorage = isSharedDataStorageAccount(normalizedEmail);
  const effectiveTtl = isSharedStorage ? 15 * 60 * 1000 : CACHE_TTL_MS; // 15 mins for shared data drives

  // Prune expired cache entries to prevent memory growth
  if (userDriveCache.size > 50) {
    for (const [key, entry] of userDriveCache.entries()) {
      if (now - entry.timestamp > effectiveTtl) {
        userDriveCache.delete(key);
      }
    }
  }
  if (pendingDrivePagination.size > 50) {
    for (const [key, entry] of pendingDrivePagination.entries()) {
      if (now - entry.timestamp > effectiveTtl) {
        pendingDrivePagination.delete(key);
      }
    }
  }

  if (cached && now - cached.timestamp < effectiveTtl) {
    return cached.items;
  }

  const token = await getGraphAccessToken();
  const allItems: GraphDriveItem[] = [];
  let nextUrl: string | undefined;
  let pageCount = 0;

  // If a previous search was paused by maxPages, continue through the paginated path
  // from where it left off instead of refetching the same capped pages from scratch.
  const pending = pendingDrivePagination.get(normalizedEmail);
  if (pending && now - pending.timestamp < effectiveTtl) {
    allItems.push(...pending.items);
    nextUrl = pending.nextUrl;
    pageCount = pending.pageCount;
    pendingDrivePagination.delete(normalizedEmail);
  } else {
    nextUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(normalizedEmail)}/drive/root/delta?$select=id,name,webUrl,folder,file,image,video,parentReference,lastModifiedDateTime`;
  }

  // Shared storage drives allow up to 100 pages per cycle; personal drives allow up to 10 pages per continuation batch
  const pagesPerBatch = isSharedStorage ? 100 : 10;
  const targetMaxPages = pageCount + pagesPerBatch;
  let hasFailed = false;

  while (nextUrl && pageCount < targetMaxPages) {
    pageCount++;
    try {
      const res = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        hasFailed = true;
        console.warn(`[Personal OneDrive] Graph API delta for ${normalizedEmail} returned HTTP ${res.status}`);
        break;
      }

      const data = (await res.json()) as {
        value?: GraphDriveItem[];
        "@odata.nextLink"?: string;
      };

      const pageItems = (data.value || []).filter((item) => item.name && item.name !== "root");
      allItems.push(...pageItems);

      nextUrl = data["@odata.nextLink"];
    } catch (fetchErr) {
      hasFailed = true;
      console.warn(`[Personal OneDrive] Error fetching delta page ${pageCount}:`, fetchErr instanceof Error ? fetchErr.message : "Network error");
      break;
    }
  }

  if (hasFailed) {
    pendingDrivePagination.delete(normalizedEmail);
    throw new Error(`Failed to fetch OneDrive items for ${normalizedEmail}`);
  }

  // Only cache in userDriveCache if the listing completed successfully and was not truncated while nextUrl still exists
  const isComplete = !nextUrl;
  if (isComplete) {
    pendingDrivePagination.delete(normalizedEmail);
    userDriveCache.set(normalizedEmail, { items: allItems, timestamp: now });
  } else if (nextUrl) {
    pendingDrivePagination.set(normalizedEmail, {
      items: allItems,
      nextUrl,
      pageCount,
      timestamp: now,
    });
    console.warn(
      `[Personal OneDrive] Listing for ${normalizedEmail} paused at page ${pageCount} with remaining pages; continuing pagination on next search (incomplete listing not cached in userDriveCache).`
    );
  }
  return allItems;
}

/**
 * Searches the authenticated employee's personal OneDrive by email.
 * Automatically handles personal files without requiring manual interactive SSO.
 */
export async function searchPersonalOneDrive(
  query: string,
  userEmail: string
): Promise<OneDriveRecord[]> {
  if (!userEmail || !userEmail.includes("@")) {
    return [];
  }

  const normalizedEmail = userEmail.toLowerCase().trim();
  let items: GraphDriveItem[] = [];
  try {
    items = await fetchUserDriveItems(normalizedEmail);
  } catch {
    console.warn(`[Personal OneDrive] Search failed for ${normalizedEmail}; returning empty results.`);
    return [];
  }

  if (!items || items.length === 0) {
    return [];
  }

  const cleanQuery = query.trim().toLowerCase();
  const isRecentIntent = /\b(recent|recently|latest|newest|today|yesterday|this week|all files)\b/i.test(cleanQuery);
  const records: OneDriveRecord[] = [];

  if (isRecentIntent || !cleanQuery) {
    // Return recent media items or folders sorted by last modified date descending
    const validItems = items.filter((item) => determineType(item) !== null);
    const sorted = validItems
      .sort((a, b) => {
        const timeA = a.lastModifiedDateTime ? Date.parse(a.lastModifiedDateTime) : 0;
        const timeB = b.lastModifiedDateTime ? Date.parse(b.lastModifiedDateTime) : 0;
        return timeB - timeA;
      })
      .slice(0, 10);

    for (const item of sorted) {
      const recordType = determineType(item)!;
      const isFolder = recordType === "folder";
      const folderPath = cleanParentPath(item.parentReference?.path);
      const folderName = isFolder ? item.name : folderPath.split("/").pop() || "Personal OneDrive";
      const folderWebUrl = getFolderWebUrl(item, isFolder);

      records.push({
        item_id: `personal-${item.id}`,
        record_type: recordType,
        name: item.name,
        file_web_url: isFolder ? null : item.webUrl,
        parent_folder_id: item.parentReference?.id ?? null,
        parent_folder_name: folderName,
        folder_path: folderPath,
        folder_web_url: folderWebUrl,
        thumbnail_url: null,
        media_type: isFolder ? null : recordType,
        visual_summary: `Personal asset in ${folderPath}`,
        visual_tags: `personal, onedrive, ${item.name.toLowerCase()}`,
        last_modified: item.lastModifiedDateTime || new Date().toISOString(),
        similarity: 0.70,
        is_personal: true,
        drive_scope: "personal",
      });
    }

    return records;
  }

  // Extract non-stopword query tokens
  const rawTerms = cleanQuery
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);

  const meaningfulTerms = rawTerms.filter((t) => !STOP_WORDS.has(t));
  const termsToMatch = meaningfulTerms.length > 0 ? meaningfulTerms : rawTerms;

  if (termsToMatch.length === 0) {
    return [];
  }

  const scoredItems: Array<{ item: GraphDriveItem; score: number; type: RecordType }> = [];

  for (const item of items) {
    const type = determineType(item);
    if (!type) continue; // Exclude non-media and non-folder items (.xlsx, .docx, .osts, etc.)

    const itemName = item.name.toLowerCase();
    const itemPath = cleanParentPath(item.parentReference?.path).toLowerCase();
    const fullText = `${itemPath}/${itemName}`;

    let score = 0;

    // Exact phrase match
    if (fullText.includes(cleanQuery)) {
      score = 0.90;
    } else {
      let matchedCount = 0;
      for (const term of termsToMatch) {
        if (itemName.includes(term) || itemPath.includes(term)) {
          matchedCount++;
        }
      }

      if (matchedCount > 0) {
        const matchRatio = matchedCount / termsToMatch.length;
        // Multi-term queries require matching at least 2 terms if 3+ terms, or >= 35% of terms
        const minMatchesRequired = termsToMatch.length >= 3 ? 2 : 1;
        if (matchedCount >= minMatchesRequired && matchRatio >= 0.35) {
          score = 0.45 + matchRatio * 0.40; // Scores between 0.45 and 0.85
        }
      }
    }

    if (score > 0) {
      scoredItems.push({ item, score, type });
    }
  }

  // Sort matched items by relevance descending
  scoredItems.sort((a, b) => b.score - a.score);

  for (const { item, score, type } of scoredItems.slice(0, 10)) {
    const isFolder = type === "folder";
    const folderPath = cleanParentPath(item.parentReference?.path);
    const folderName = isFolder ? item.name : folderPath.split("/").pop() || "Personal OneDrive";
    const folderWebUrl = getFolderWebUrl(item, isFolder);

    records.push({
      item_id: `personal-${item.id}`,
      record_type: type,
      name: item.name,
      file_web_url: isFolder ? null : item.webUrl,
      parent_folder_id: item.parentReference?.id ?? null,
      parent_folder_name: folderName,
      folder_path: folderPath,
      folder_web_url: folderWebUrl,
      thumbnail_url: null,
      media_type: isFolder ? null : type,
      visual_summary: `Personal asset in ${folderPath}`,
      visual_tags: `personal, onedrive, ${item.name.toLowerCase()}`,
      last_modified: item.lastModifiedDateTime || new Date().toISOString(),
      similarity: score,
      is_personal: true,
      drive_scope: "personal",
    });
  }

  return records;
}

/**
 * Searches across the two designated enterprise data storage accounts
 * (data.brandelier@brandelier.in & data.brandelier2@brandelier.in)
 * whose files and folders are accessible to all users.
 */
export async function searchSharedDataStorage(query: string): Promise<OneDriveRecord[]> {
  const accounts: readonly string[] = SHARED_DATA_STORAGE_ACCOUNTS;
  const results = await Promise.all(
    accounts.map(async (acc: string) => {
      try {
        const records = await searchPersonalOneDrive(query, acc);
        const isStore2 = acc.includes("2");
        const storeLabel = isStore2 ? "Data Storage 2" : "Data Storage 1";
        return records.map((r) => ({
          ...r,
          item_id: `storage-${isStore2 ? "2" : "1"}-${r.item_id.replace(/^personal-/, "")}`,
          drive_scope: "shared_storage" as const,
          storage_account: acc,
          is_personal: false,
          visual_summary: `[${storeLabel} Asset]: ${r.folder_path} / ${r.name}`,
        }));
      } catch (err) {
        console.warn(`[Shared Storage] Error searching ${acc}:`, err);
        return [];
      }
    })
  );

  return results.flat();
}
