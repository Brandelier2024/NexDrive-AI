import { config } from "@/lib/config";
import { getGraphAccessToken } from "@/lib/graph/auth";
import {
  fetchItemThumbnailUrl,
  describeThumbnail,
  isGeminiConfigured,
  generateFallbackMetadata,
} from "./vision-describer";
import { OneDriveGraphItem, OneDriveRecord, RecordType } from "@/lib/types";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "heic", "raw"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "avi", "mkv", "wmv", "m4v", "webm"]);

/**
 * Determines record type from Graph Item facets and file extension
 */
export function determineRecordType(item: OneDriveGraphItem): RecordType | null {
  if (item.folder) {
    return "folder";
  }

  const ext = item.name.split(".").pop()?.toLowerCase() || "";

  if (item.image || IMAGE_EXTENSIONS.has(ext)) {
    return "image";
  }

  if (item.video || VIDEO_EXTENSIONS.has(ext)) {
    return "video";
  }

  // Not a folder, image, or video
  return null;
}

/**
 * Cleans Graph API parentReference.path into human-readable path
 * e.g. "/drives/b!abc/root:/Brand_Assets/2026_Campaigns" -> "Brand_Assets/2026_Campaigns"
 */
export function cleanFolderPath(rawPath?: string): string {
  if (!rawPath) return "Root";
  return rawPath
    .replace(/^\/drives\/[^/]+\/root:?/, "")
    .replace(/^\/drive\/root:?/, "")
    .replace(/^\/+/, "") || "Root";
}

export interface CrawlResult {
  recordsToUpsert: OneDriveRecord[];
  itemIdsToDelete: string[];
  newDeltaLink: string | null;
}

/**
 * Crawls OneDrive using Microsoft Graph /delta endpoint.
 * Supports incremental sync via deltaLink.
 */
export async function crawlOneDriveDelta(previousDeltaLink?: string | null): Promise<CrawlResult> {
  const { driveId } = config.azure;
  const accessToken = await getGraphAccessToken();

  let nextUrl: string | null =
    previousDeltaLink ||
    `https://graph.microsoft.com/v1.0/drives/${driveId}/root/delta?$select=id,name,webUrl,folder,image,video,file,parentReference,lastModifiedDateTime`;

  const rawItems: OneDriveGraphItem[] = [];
  let newDeltaLink: string | null = null;
  let pageNum = 0;

  let currentAccessToken = accessToken;

  // 1. Paginate through Graph API /delta with 429 retry and 401 token refresh handling
  while (nextUrl) {
    let attempts = 0;
    let res: Response | null = null;
    while (attempts < 4) {
      res = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${currentAccessToken}`,
        },
      });

      if (res.status === 401) {
        attempts++;
        console.warn("[Graph API] Access token expired mid-crawl. Refreshing token...");
        currentAccessToken = await getGraphAccessToken();
        continue;
      }

      if (res.status === 429) {
        attempts++;
        const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
        console.warn(`[Graph API] Rate limited (429). Backing off for ${retryAfter}s (attempt ${attempts}/4)...`);
        await new Promise((resolve) => setTimeout(resolve, (retryAfter + 1) * 1000));
      } else {
        break;
      }
    }

    if (!res || !res.ok) {
      const errText = res ? await res.text() : "Network error";
      throw new Error(`Graph API delta request failed (${res?.status}): ${errText}`);
    }

    pageNum++;
    const data = (await res.json()) as {
      value?: OneDriveGraphItem[];
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    };

    if (data.value && data.value.length > 0) {
      rawItems.push(...data.value);
    }
    console.log(`[Crawl] Page ${pageNum}: +${data.value?.length || 0} items (accumulated: ${rawItems.length})`);

    if (data["@odata.nextLink"]) {
      nextUrl = data["@odata.nextLink"];
      // Gentle 500ms breather to prevent Microsoft Graph pagination throttling
      await new Promise((resolve) => setTimeout(resolve, 500));
    } else {
      nextUrl = null;
      if (data["@odata.deltaLink"]) {
        newDeltaLink = data["@odata.deltaLink"];
      }
    }
  }

  // 2. Separate active items and deleted items (deduplicated by item.id)
  const itemIdsToDelete: string[] = [];
  const activeItemsMap = new Map<string, OneDriveGraphItem>();

  for (const item of rawItems) {
    if (item.deleted) {
      itemIdsToDelete.push(item.id);
      activeItemsMap.delete(item.id);
    } else {
      activeItemsMap.set(item.id, item);
    }
  }

  const activeItems = Array.from(activeItemsMap.values());

  // 3. Build Folder Lookup Map for parent resolution
  const folderMap = new Map<
    string,
    { id: string; name: string; webUrl: string; path: string }
  >();

  for (const item of activeItems) {
    if (item.folder) {
      const parentPath = cleanFolderPath(item.parentReference?.path);
      const fullPath = parentPath === "Root" ? item.name : `${parentPath}/${item.name}`;
      folderMap.set(item.id, {
        id: item.id,
        name: item.name,
        webUrl: item.webUrl,
        path: fullPath,
      });
    }
  }

  // 4. Process all folders and media items
  const relevantItems = activeItems.filter((item) => determineRecordType(item) !== null);
  const recordsToUpsert: OneDriveRecord[] = [];
  const enableVision = config.gemini.enableVisionCaptioning && isGeminiConfigured();

  if (enableVision) {
    const BATCH_SIZE = 15;
    for (let i = 0; i < relevantItems.length; i += BATCH_SIZE) {
      const chunk = relevantItems.slice(i, i + BATCH_SIZE);
      const chunkResults = await Promise.all(
        chunk.map(async (item) => {
          const recordType = determineRecordType(item)!;
          const parentId = item.parentReference?.id ?? null;
          const parentFolderInfo = parentId ? folderMap.get(parentId) : undefined;
          const parentName = parentFolderInfo?.name ?? null;
          const folderWebUrl =
            recordType === "folder"
              ? item.webUrl
              : parentFolderInfo?.webUrl || item.webUrl;

          const folderPath =
            recordType === "folder"
              ? folderMap.get(item.id)?.path || cleanFolderPath(item.parentReference?.path)
              : parentFolderInfo?.path || cleanFolderPath(item.parentReference?.path);

          let thumbnailUrl: string | null = null;
          let visualSummary: string | null = null;
          let visualTags: string | null = null;

          if (recordType === "image" || recordType === "video") {
            thumbnailUrl = await fetchItemThumbnailUrl(accessToken, driveId, item.id);
            const vision = await describeThumbnail(thumbnailUrl, item.name, folderPath);
            visualSummary = vision.summary;
            visualTags = vision.tags;
          } else {
            visualSummary = `Folder "${item.name}" containing company media assets at ${folderPath}`;
            visualTags = folderPath.replace(/[/_-]/g, ", ");
          }

          return {
            item_id: item.id,
            record_type: recordType,
            name: item.name,
            file_web_url: recordType === "folder" ? null : item.webUrl,
            parent_folder_id: parentId,
            parent_folder_name: parentName,
            folder_path: folderPath,
            folder_web_url: folderWebUrl,
            thumbnail_url: thumbnailUrl,
            media_type: item.file?.mimeType ?? (recordType === "video" ? "video/mp4" : "image/jpeg"),
            visual_summary: visualSummary,
            visual_tags: visualTags,
            last_modified: item.lastModifiedDateTime ?? new Date().toISOString(),
          } as OneDriveRecord;
        })
      );

      recordsToUpsert.push(...chunkResults);
    }
  } else {
    // Ultra-fast in-memory path (0.05s for 20,000+ items)
    for (const item of relevantItems) {
      const recordType = determineRecordType(item)!;
      const parentId = item.parentReference?.id ?? null;
      const parentFolderInfo = parentId ? folderMap.get(parentId) : undefined;
      const parentName = parentFolderInfo?.name ?? null;
      const folderWebUrl =
        recordType === "folder"
          ? item.webUrl
          : parentFolderInfo?.webUrl || item.webUrl;

      const folderPath =
        recordType === "folder"
          ? folderMap.get(item.id)?.path || cleanFolderPath(item.parentReference?.path)
          : parentFolderInfo?.path || cleanFolderPath(item.parentReference?.path);

      const fallback = generateFallbackMetadata(item.name, folderPath);

      recordsToUpsert.push({
        item_id: item.id,
        record_type: recordType,
        name: item.name,
        file_web_url: recordType === "folder" ? null : item.webUrl,
        parent_folder_id: parentId,
        parent_folder_name: parentName,
        folder_path: folderPath,
        folder_web_url: folderWebUrl,
        thumbnail_url: null,
        media_type: item.file?.mimeType ?? (recordType === "video" ? "video/mp4" : "image/jpeg"),
        visual_summary:
          recordType === "folder"
            ? `Folder "${item.name}" containing company media assets at ${folderPath}`
            : fallback.summary,
        visual_tags:
          recordType === "folder"
            ? folderPath.replace(/[/_-]/g, ", ")
            : fallback.tags,
        last_modified: item.lastModifiedDateTime ?? new Date().toISOString(),
      });
    }
    console.log(`[Crawler] Fast metadata prepared ${recordsToUpsert.length} items.`);
  }

  return {
    recordsToUpsert,
    itemIdsToDelete,
    newDeltaLink,
  };
}
