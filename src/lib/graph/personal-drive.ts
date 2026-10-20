import { getGraphAccessToken } from "./auth";
import { OneDriveRecord, RecordType } from "@/lib/types";

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

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "heic", "raw"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "avi", "mkv", "wmv", "m4v", "webm"]);

function determineType(item: GraphDriveItem): RecordType {
  if (item.folder) return "folder";
  const ext = item.name.split(".").pop()?.toLowerCase() || "";
  if (item.video || VIDEO_EXTENSIONS.has(ext)) return "video";
  if (item.image || IMAGE_EXTENSIONS.has(ext)) return "image";
  return "folder";
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
 * Derives parent folder webUrl dynamically without hardcoding tenant URLs
 */
function getFolderWebUrl(
  item: GraphDriveItem,
  isFolder: boolean,
  folderPath: string,
  normalizedEmail: string
): string {
  if (isFolder) {
    return item.webUrl;
  }

  // Derive parent folder directly from the file's verified webUrl
  if (item.webUrl && item.webUrl.includes("/")) {
    const parentUrl = item.webUrl.substring(0, item.webUrl.lastIndexOf("/"));
    if (parentUrl.startsWith("http")) {
      return parentUrl;
    }
  }

  // Fallback: use environment variable or tenant base
  const tenantBase = process.env.SHAREPOINT_BASE_URL || "https://brandeliermediaworksllp-my.sharepoint.com";
  const userSegment = normalizedEmail.replace(/[@.]/g, "_");
  const subpath = folderPath && folderPath !== "My OneDrive" ? `/${encodeURIComponent(folderPath)}` : "";
  return `${tenantBase}/personal/${userSegment}/Documents${subpath}`;
}

/**
 * Fetches all items from the employee's personal OneDrive via Microsoft Graph /delta
 * with automatic pagination, request timeout, and cache eviction.
 */
async function fetchUserDriveItems(userEmail: string): Promise<GraphDriveItem[]> {
  const normalizedEmail = userEmail.toLowerCase().trim();
  const cached = userDriveCache.get(normalizedEmail);
  const now = Date.now();

  // Prune expired cache entries to prevent memory growth
  if (userDriveCache.size > 50) {
    for (const [key, entry] of userDriveCache.entries()) {
      if (now - entry.timestamp > CACHE_TTL_MS) {
        userDriveCache.delete(key);
      }
    }
  }

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.items;
  }

  const token = await getGraphAccessToken();
  let nextUrl: string | undefined = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(normalizedEmail)}/drive/root/delta?$select=id,name,webUrl,folder,file,image,video,parentReference,lastModifiedDateTime`;
  const allItems: GraphDriveItem[] = [];
  let pageCount = 0;
  const maxPages = 5; // Cap to 5 pages (~1,000 items) for latency safety

  while (nextUrl && pageCount < maxPages) {
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
        const errText = await res.text().catch(() => "");
        console.warn(`[Personal OneDrive] Graph API delta for ${normalizedEmail} returned ${res.status}:`, errText);
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
      console.warn(`[Personal OneDrive] Error fetching delta page ${pageCount}:`, fetchErr);
      break;
    }
  }

  userDriveCache.set(normalizedEmail, { items: allItems, timestamp: now });
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
  const items = await fetchUserDriveItems(normalizedEmail);

  if (!items || items.length === 0) {
    return [];
  }

  const cleanQuery = query.trim().toLowerCase();
  const isRecentIntent = /\b(recent|recently|latest|newest|today|yesterday|this week|all files)\b/i.test(cleanQuery);

  // Filter items matching query
  let filteredItems: GraphDriveItem[] = [];

  if (isRecentIntent || !cleanQuery) {
    // Return recent items sorted by last modified date descending
    filteredItems = [...items]
      .sort((a, b) => {
        const timeA = a.lastModifiedDateTime ? Date.parse(a.lastModifiedDateTime) : 0;
        const timeB = b.lastModifiedDateTime ? Date.parse(b.lastModifiedDateTime) : 0;
        return timeB - timeA;
      })
      .slice(0, 15);
  } else {
    // Keyword matching on item name and parent folder path
    const searchTerms = cleanQuery
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);

    filteredItems = items.filter((item) => {
      const name = item.name.toLowerCase();
      const path = (item.parentReference?.path || "").toLowerCase();

      // Check if any search term matches
      return searchTerms.some((term) => name.includes(term) || path.includes(term));
    });

    // If still no matches, try substring match on original query
    if (filteredItems.length === 0) {
      filteredItems = items.filter((item) => {
        const name = item.name.toLowerCase();
        return name.includes(cleanQuery);
      });
    }
  }

  const records: OneDriveRecord[] = [];

  for (const item of filteredItems.slice(0, 15)) {
    const recordType = determineType(item);
    const isFolder = recordType === "folder";
    const folderPath = cleanParentPath(item.parentReference?.path);
    const folderName = isFolder ? item.name : folderPath.split("/").pop() || "Personal OneDrive";
    const folderWebUrl = getFolderWebUrl(item, isFolder, folderPath, normalizedEmail);

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
      media_type: recordType === "folder" ? null : recordType,
      visual_summary: `Personal asset in ${folderPath}`,
      visual_tags: `personal, onedrive, ${item.name.toLowerCase()}`,
      last_modified: item.lastModifiedDateTime || new Date().toISOString(),
      similarity: 0.99,
      is_personal: true,
      drive_scope: "personal",
    });
  }

  return records;
}
