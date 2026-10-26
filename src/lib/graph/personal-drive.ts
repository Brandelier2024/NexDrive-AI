import { getGraphAccessToken, isAzureConfigured } from "./auth";
import { OneDriveRecord, RecordType } from "@/lib/types";
import { STOP_WORDS } from "@/lib/retrieval/retriever";
import { isCompanyEmail } from "@/lib/config";

export interface GraphDriveItem {
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
interface IncompletePaginationState {
  items: GraphDriveItem[];
  nextUrl: string;
  pageCount: number;
  timestamp: number;
}
const pendingDrivePagination = new Map<string, IncompletePaginationState>();

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "heic", "raw"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "avi", "mkv", "wmv", "m4v", "webm"]);

export function determineType(item: GraphDriveItem): RecordType | null {
  if (item.folder) return "folder";
  const ext = item.name.split(".").pop()?.toLowerCase() || "";
  if (item.video || VIDEO_EXTENSIONS.has(ext)) return "video";
  if (item.image || IMAGE_EXTENSIONS.has(ext)) return "image";
  return null;
}

const parentPathCache = new Map<string, string>();
export function cleanParentPath(rawPath?: string): string {
  if (!rawPath) return "My OneDrive";
  const hit = parentPathCache.get(rawPath);
  if (hit !== undefined) return hit;

  const cleaned = rawPath
    .replace(/^\/drives\/[^/]+\/root:?/, "")
    .replace(/^\/drive\/root:?/, "")
    .replace(/^:+/, "")
    .replace(/^\/+/, "");
  const result = cleaned || "My OneDrive";
  if (parentPathCache.size > 2000) parentPathCache.clear();
  parentPathCache.set(rawPath, result);
  return result;
}

/**
 * Derives parent folder webUrl directly from item.webUrl without hardcoded tenant URLs
 */
export function getFolderWebUrl(item: GraphDriveItem, isFolder: boolean): string {
  if (isFolder || !item.webUrl) {
    return item.webUrl || "";
  }

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

const SHARED_STORAGE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours for enterprise shared storage
const activeBackgroundSyncs = new Map<string, number>();
const BACKGROUND_SYNC_TIMEOUT_MS = 60 * 1000; // 1 minute expiration

// ─────────────────────────────────────────────────────────────
// 1. OData Query Sanitizer
// ─────────────────────────────────────────────────────────────

/**
 * Sanitizes and escapes queries for Microsoft Graph OData search:
 * `GET /users/{email}/drive/root/search(q='{escaped}')`
 * - Strips control characters (\x00-\x1f, \x7f), null bytes, newlines, tabs.
 * - Strips dangerous delimiters and characters: &, ?, #, ;, $, (, ), <, >, \.
 * - Normalizes redundant whitespace.
 * - Enforces max length (100 characters) to prevent ReDoS / payload bloating.
 * - Doubles single quotes per OData specification (' -> '').
 */
export function sanitizeODataSearchQuery(query: string): string {
  if (!query || typeof query !== "string") return "";

  // 1. Replace newlines, carriage returns, and tabs with spaces, then strip remaining control characters & null bytes
  let sanitized = query.replace(/[\r\n\t]/g, " ").replace(/[\x00-\x1F\x7F]/g, "");

  // 2. Strip characters that can break URL/OData query syntax
  sanitized = sanitized.replace(/[&?#;$()<>\\]/g, " ");

  // 3. Normalize multiple whitespaces
  sanitized = sanitized.replace(/\s+/g, " ").trim();

  // 4. Enforce strict max length (100 characters) before quote expansion
  if (sanitized.length > 100) {
    sanitized = sanitized.slice(0, 100).trim();
  }

  // 5. Escape single quotes by doubling them per OData specification
  sanitized = sanitized.replace(/'/g, "''");

  return sanitized;
}

// ─────────────────────────────────────────────────────────────
// 2. Circuit Breaker for Microsoft Graph API & Rate Limit Resilience
// ─────────────────────────────────────────────────────────────

export interface CircuitBreakerStatus {
  isOpen: boolean;
  trippedUntil: number | null;
  reason: string | null;
  consecutiveFailures: number;
}

let circuitOpenUntil = 0;
let circuitReason: string | null = null;
let consecutiveFailures = 0;

export function getGraphCircuitBreakerStatus(): CircuitBreakerStatus {
  const now = Date.now();
  const isOpen = circuitOpenUntil > now;
  return {
    isOpen,
    trippedUntil: isOpen ? circuitOpenUntil : null,
    reason: isOpen ? circuitReason : null,
    consecutiveFailures,
  };
}

export function tripGraphCircuitBreaker(cooldownMs: number, reason: string): void {
  const clampedCooldown = Math.max(5000, Math.min(cooldownMs, 300000)); // 5s to 5m
  circuitOpenUntil = Date.now() + clampedCooldown;
  circuitReason = reason;
}

export function resetGraphCircuitBreaker(): void {
  circuitOpenUntil = 0;
  circuitReason = null;
  consecutiveFailures = 0;
}

export function recordGraphSuccess(): void {
  consecutiveFailures = 0;
}

export function recordGraphFailure(reason?: string): void {
  consecutiveFailures++;
  if (consecutiveFailures >= 3) {
    tripGraphCircuitBreaker(30000, reason || "3 consecutive Microsoft Graph failures or timeouts");
  }
}

// ─────────────────────────────────────────────────────────────
// 3. Auto-Sync Cooldown Management (10-minute minimum interval)
// ─────────────────────────────────────────────────────────────

const AUTO_SYNC_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
const lastAutoSyncMap = new Map<string, number>();

export function canTriggerAutoSync(scopeKey: string): boolean {
  // If circuit breaker is open, NEVER auto-sync!
  if (getGraphCircuitBreakerStatus().isOpen) {
    return false;
  }
  const key = scopeKey.toLowerCase().trim();
  const lastTime = lastAutoSyncMap.get(key);
  if (!lastTime) return true;
  return Date.now() - lastTime > AUTO_SYNC_COOLDOWN_MS;
}

export function recordAutoSyncAttempt(scopeKey: string): void {
  const key = scopeKey.toLowerCase().trim();
  lastAutoSyncMap.set(key, Date.now());
}

export function resetAutoSyncCooldown(scopeKey?: string): void {
  if (scopeKey) {
    lastAutoSyncMap.delete(scopeKey.toLowerCase().trim());
  } else {
    lastAutoSyncMap.clear();
  }
}

// ─────────────────────────────────────────────────────────────
// 4. Background Self-Healing Asynchronous Upsert
// ─────────────────────────────────────────────────────────────

function scheduleBackgroundUpsert(records: OneDriveRecord[]): void {
  if (!records || records.length === 0) return;
  // Detached asynchronous upsert to Supabase - does NOT block query latency
  Promise.resolve().then(async () => {
    try {
      const { upsertOneDriveRecords } = await import("@/lib/crawler/indexer");
      await upsertOneDriveRecords(records);
    } catch (e) {
      console.warn("[Personal OneDrive] Background upsert failed:", e);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// 5. Targeted 1-Call Native Microsoft Graph Search
// ─────────────────────────────────────────────────────────────

/**
 * Executes a targeted 1-call server-side search directly on Microsoft Graph.
 * Latency is ~0.5s–0.8s, eliminating the 80+ sequential delta page fetches.
 */
export async function searchGraphDriveNative(
  rawQuery: string,
  userEmail: string,
  options?: {
    timeoutMs?: number;
    top?: number;
  }
): Promise<GraphDriveItem[]> {
  if (!userEmail || typeof userEmail !== "string") {
    return [];
  }
  const normalizedEmail = userEmail.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return [];
  }
  if (!isSharedDataStorageAccount(normalizedEmail) && !isCompanyEmail(normalizedEmail)) {
    return [];
  }

  // Fast-fail if circuit breaker is open
  const breaker = getGraphCircuitBreakerStatus();
  if (breaker.isOpen) {
    console.warn(`[Graph Search] Circuit breaker OPEN (${breaker.reason}). Fast-skipping Graph call for ${normalizedEmail}.`);
    return [];
  }

  const sanitized = sanitizeODataSearchQuery(rawQuery);
  if (!sanitized) {
    return [];
  }

  const timeoutMs = options?.timeoutMs ?? 3500;
  const top = options?.top ?? 15;

  try {
    const token = await getGraphAccessToken();
    const escapedQuery = encodeURIComponent(sanitized).replace(/%27/g, "'");
    const endpoint = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      normalizedEmail
    )}/drive/root/search(q='${escapedQuery}')?$top=${top}&$select=id,name,webUrl,folder,file,image,video,parentReference,lastModifiedDateTime`;

    const res = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status === 429) {
      const retryAfterHeader = res.headers.get("Retry-After");
      const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;
      const cooldownMs = (isNaN(retryAfterSec) || retryAfterSec <= 0 ? 60 : retryAfterSec) * 1000;
      tripGraphCircuitBreaker(cooldownMs, `HTTP 429 Too Many Requests: Retry-After ${retryAfterSec}s`);
      console.warn(`[Graph Search] HTTP 429 rate limit hit for ${normalizedEmail}. Tripping circuit breaker for ${retryAfterSec}s.`);
      return [];
    }

    if (res.status === 404) {
      console.warn(`[Graph Search] Drive or user ${normalizedEmail} not found (HTTP 404).`);
      return [];
    }

    if (!res.ok) {
      recordGraphFailure(`HTTP ${res.status}`);
      console.warn(`[Graph Search] HTTP ${res.status} returned from Graph search for ${normalizedEmail}.`);
      return [];
    }

    const data = (await res.json()) as { value?: GraphDriveItem[] };
    recordGraphSuccess();
    return (data.value || []).filter((item) => item.name && item.name !== "root");
  } catch (err: unknown) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" ||
        err.name === "AbortError" ||
        err.message.toLowerCase().includes("timeout") ||
        err.message.toLowerCase().includes("aborted"));

    if (isTimeout) {
      console.warn(`[Graph Search] Request timed out (${timeoutMs}ms) for ${normalizedEmail}.`);
      recordGraphFailure(`Timeout (${timeoutMs}ms)`);
    } else {
      console.warn(`[Graph Search] Error searching drive for ${normalizedEmail}:`, err instanceof Error ? err.message : err);
      recordGraphFailure("Network error");
    }
    return [];
  }
}

/**
 * Fetches recent items in 1 single HTTP request via Graph children ordered by lastModifiedDateTime.
 */
export async function fetchRecentGraphDriveItems(
  userEmail: string,
  top: number = 10,
  timeoutMs: number = 3500
): Promise<GraphDriveItem[]> {
  const normalizedEmail = userEmail.toLowerCase().trim();
  const breaker = getGraphCircuitBreakerStatus();
  if (breaker.isOpen) return [];

  try {
    const token = await getGraphAccessToken();
    const endpoint = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      normalizedEmail
    )}/drive/root/children?$orderby=lastModifiedDateTime desc&$top=${top}&$select=id,name,webUrl,folder,file,image,video,parentReference,lastModifiedDateTime`;

    const res = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status === 429) {
      const retryAfterHeader = res.headers.get("Retry-After");
      const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;
      tripGraphCircuitBreaker(retryAfterSec * 1000, `HTTP 429 on recent items: ${retryAfterSec}s`);
      return [];
    }

    if (!res.ok) {
      recordGraphFailure(`Recent HTTP ${res.status}`);
      return [];
    }

    const data = (await res.json()) as { value?: GraphDriveItem[] };
    recordGraphSuccess();
    return (data.value || []).filter((item) => item.name && item.name !== "root");
  } catch (err) {
    recordGraphFailure("Recent items error");
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// 6. Record Mapping & In-Memory Scoring Helpers
// ─────────────────────────────────────────────────────────────

export function mapGraphItemToOneDriveRecord(
  item: GraphDriveItem,
  options: {
    isPersonal: boolean;
    driveScope: "personal" | "shared_storage";
    storageAccount?: string;
    similarity?: number;
  }
): OneDriveRecord | null {
  const type = determineType(item);
  if (!type) return null;

  const isFolder = type === "folder";
  const folderPath = cleanParentPath(item.parentReference?.path);
  const folderName = isFolder ? item.name : folderPath.split("/").pop() || (options.isPersonal ? "Personal OneDrive" : "Shared Storage");
  const folderWebUrl = getFolderWebUrl(item, isFolder);
  const itemId = options.isPersonal
    ? `personal-${item.id}`
    : `storage-${options.storageAccount?.includes("2") ? "2" : "1"}-${item.id}`;

  const storeLabel = options.storageAccount?.includes("2") ? "Data Storage 2" : "Data Storage 1";
  const visualSummary = options.isPersonal
    ? `Personal asset in ${folderPath}`
    : `[${storeLabel} Asset]: ${folderPath} / ${item.name}`;

  return {
    item_id: itemId,
    record_type: type,
    name: item.name,
    file_web_url: isFolder ? null : item.webUrl,
    parent_folder_id: item.parentReference?.id ?? null,
    parent_folder_name: folderName,
    folder_path: folderPath,
    folder_web_url: folderWebUrl,
    thumbnail_url: null,
    media_type: isFolder ? null : type,
    visual_summary: visualSummary,
    visual_tags: `${options.isPersonal ? "personal" : "shared_storage"}, onedrive, ${item.name.toLowerCase()}`,
    last_modified: item.lastModifiedDateTime || new Date().toISOString(),
    similarity: options.similarity ?? 0.85,
    is_personal: options.isPersonal,
    drive_scope: options.driveScope,
    storage_account: options.storageAccount,
  };
}

export function scoreAndFilterDriveItems(
  items: GraphDriveItem[],
  cleanQuery: string,
  isRecentIntent: boolean,
  normalizedEmail: string
): OneDriveRecord[] {
  const isSharedStorage = isSharedDataStorageAccount(normalizedEmail);
  const records: OneDriveRecord[] = [];

  if (isRecentIntent || !cleanQuery) {
    const validItems = items.filter((item) => determineType(item) !== null);
    const sorted = validItems
      .sort((a, b) => {
        const timeA = a.lastModifiedDateTime ? Date.parse(a.lastModifiedDateTime) : 0;
        const timeB = b.lastModifiedDateTime ? Date.parse(b.lastModifiedDateTime) : 0;
        return timeB - timeA;
      })
      .slice(0, 10);

    for (const item of sorted) {
      const rec = mapGraphItemToOneDriveRecord(item, {
        isPersonal: !isSharedStorage,
        driveScope: isSharedStorage ? "shared_storage" : "personal",
        storageAccount: isSharedStorage ? normalizedEmail : undefined,
        similarity: 0.70,
      });
      if (rec) records.push(rec);
    }
    return records;
  }

  const rawTerms = cleanQuery
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);

  const meaningfulTerms = rawTerms.filter((t) => !STOP_WORDS.has(t));
  const termsToMatch = meaningfulTerms.length > 0 ? meaningfulTerms : rawTerms;

  if (termsToMatch.length === 0) {
    return [];
  }

  const scoredItems: Array<{ item: GraphDriveItem; score: number }> = [];

  for (const item of items) {
    const type = determineType(item);
    if (!type) continue;

    const itemName = item.name.toLowerCase();
    const itemPath = cleanParentPath(item.parentReference?.path).toLowerCase();
    const fullText = `${itemPath}/${itemName}`;

    let score = 0;

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
        const minMatchesRequired = termsToMatch.length >= 3 ? 2 : 1;
        if (matchedCount >= minMatchesRequired && matchRatio >= 0.35) {
          score = 0.45 + matchRatio * 0.40;
        }
      }
    }

    if (score > 0) {
      scoredItems.push({ item, score });
    }
  }

  scoredItems.sort((a, b) => b.score - a.score);

  for (const { item, score } of scoredItems.slice(0, 10)) {
    const rec = mapGraphItemToOneDriveRecord(item, {
      isPersonal: !isSharedStorage,
      driveScope: isSharedStorage ? "shared_storage" : "personal",
      storageAccount: isSharedStorage ? normalizedEmail : undefined,
      similarity: score,
    });
    if (rec) records.push(rec);
  }

  return records;
}

// ─────────────────────────────────────────────────────────────
// 7. Background Delta Crawl (Maintained for Warmup / Sync)
// ─────────────────────────────────────────────────────────────

/**
 * Fetches items from an employee's personal OneDrive or corporate data storage account via Microsoft Graph /delta
 * with automatic pagination, request timeout, and cache eviction.
 * Used for background pre-warming and delta index maintenance.
 */
export async function fetchUserDriveItems(
  userEmail: string,
  bypassRevalidation: boolean = false
): Promise<GraphDriveItem[]> {
  if (!userEmail || typeof userEmail !== "string") {
    throw new Error("Invalid user email provided for OneDrive retrieval");
  }
  const normalizedEmail = userEmail.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error(`Invalid email address format: "${normalizedEmail}"`);
  }
  if (!isSharedDataStorageAccount(normalizedEmail) && !isCompanyEmail(normalizedEmail)) {
    throw new Error(`Unauthorized email domain for OneDrive search: "${normalizedEmail}"`);
  }

  // Check circuit breaker before initiating heavy delta crawl
  if (getGraphCircuitBreakerStatus().isOpen) {
    console.warn(`[Personal OneDrive] Circuit breaker OPEN. Skipping delta crawl for ${normalizedEmail}.`);
    return userDriveCache.get(normalizedEmail)?.items || [];
  }

  const cached = userDriveCache.get(normalizedEmail);
  const now = Date.now();
  const isSharedStorage = isSharedDataStorageAccount(normalizedEmail);
  const effectiveTtl = isSharedStorage ? SHARED_STORAGE_TTL_MS : CACHE_TTL_MS;

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

  // Exact cache hit within TTL
  if (cached && now - cached.timestamp < effectiveTtl) {
    return cached.items;
  }

  // Stale-While-Revalidate: For shared storage drives, serve existing cached data instantly
  if (cached && isSharedStorage && cached.items.length > 0 && !bypassRevalidation) {
    const lastSync = activeBackgroundSyncs.get(normalizedEmail);
    const isSyncActive = lastSync !== undefined && now - lastSync < BACKGROUND_SYNC_TIMEOUT_MS;
    if (!isSyncActive) {
      activeBackgroundSyncs.set(normalizedEmail, now);
      fetchUserDriveItems(normalizedEmail, true)
        .then((items) => {
          console.log(`[Personal OneDrive] Revalidated ${items.length} items for ${normalizedEmail}`);
        })
        .catch((e) => console.warn(`[Personal OneDrive] Background revalidation failed for ${normalizedEmail}:`, e))
        .finally(() => activeBackgroundSyncs.delete(normalizedEmail));
    }
    return cached.items;
  }

  const token = await getGraphAccessToken();
  const allItems: GraphDriveItem[] = [];
  let nextUrl: string | undefined;
  let pageCount = 0;

  const pending = pendingDrivePagination.get(normalizedEmail);
  if (pending && now - pending.timestamp < effectiveTtl) {
    allItems.push(...pending.items);
    nextUrl = pending.nextUrl;
    pageCount = pending.pageCount;
    pendingDrivePagination.delete(normalizedEmail);
  } else {
    nextUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(normalizedEmail)}/drive/root/delta?$select=id,name,webUrl,folder,file,image,video,parentReference,lastModifiedDateTime`;
  }

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

      if (res.status === 429) {
        hasFailed = true;
        const retryAfterHeader = res.headers.get("Retry-After");
        const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;
        tripGraphCircuitBreaker(retryAfterSec * 1000, `Delta crawl hit 429: ${retryAfterSec}s`);
        break;
      }

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
  }
  return allItems;
}

// ─────────────────────────────────────────────────────────────
// 8. Public Search Functions (Personal OneDrive & Shared Storage)
// ─────────────────────────────────────────────────────────────

/**
 * High-performance search for employee's personal OneDrive by email.
 * First checks in-memory cache, then falls back to 1-call native Graph search (~0.5s).
 * Discovered items are asynchronously upserted to Supabase in the background.
 */
export async function searchPersonalOneDrive(
  query: string,
  userEmail: string
): Promise<OneDriveRecord[]> {
  if (!userEmail || !userEmail.includes("@")) {
    return [];
  }

  const normalizedEmail = userEmail.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return [];
  }
  if (!isSharedDataStorageAccount(normalizedEmail) && !isCompanyEmail(normalizedEmail)) {
    return [];
  }

  const cleanQuery = query.trim().toLowerCase();
  const isRecentIntent = /\b(recent|recently|latest|newest|today|yesterday|this week|all files)\b/i.test(cleanQuery);
  const isSharedStorage = isSharedDataStorageAccount(normalizedEmail);
  const effectiveTtl = isSharedStorage ? SHARED_STORAGE_TTL_MS : CACHE_TTL_MS;

  // 1. Fast Path: In-memory cache hit
  const cached = userDriveCache.get(normalizedEmail);
  const now = Date.now();
  if (cached && cached.items.length > 0 && now - cached.timestamp < effectiveTtl) {
    const memoryMatches = scoreAndFilterDriveItems(cached.items, cleanQuery, isRecentIntent, normalizedEmail);
    if (memoryMatches.length > 0) {
      return memoryMatches;
    }
  }

  // 2. High-Performance 1-Call Native Microsoft Graph Search (~0.5s)
  try {
    let graphItems: GraphDriveItem[] = [];
    if (isRecentIntent || !cleanQuery) {
      graphItems = await fetchRecentGraphDriveItems(normalizedEmail, 10);
    } else {
      graphItems = await searchGraphDriveNative(cleanQuery, normalizedEmail, { top: 15 });
    }

    if (graphItems && graphItems.length > 0) {
      const records: OneDriveRecord[] = [];
      for (const item of graphItems) {
        const rec = mapGraphItemToOneDriveRecord(item, {
          isPersonal: !isSharedStorage,
          driveScope: isSharedStorage ? "shared_storage" : "personal",
          storageAccount: isSharedStorage ? normalizedEmail : undefined,
          similarity: 0.85,
        });
        if (rec) records.push(rec);
      }

      if (records.length > 0) {
        scheduleBackgroundUpsert(records);
        return records;
      }
    }
  } catch (nativeErr) {
    console.warn(`[Personal OneDrive] Native Graph search failed for ${normalizedEmail}:`, nativeErr);
  }

  // 3. Fallback: If cache had any items, check memory cache even if expired
  if (cached && cached.items.length > 0) {
    return scoreAndFilterDriveItems(cached.items, cleanQuery, isRecentIntent, normalizedEmail);
  }

  return [];
}

/**
 * Searches across the two designated enterprise data storage accounts
 * (data.brandelier@brandelier.in & data.brandelier2@brandelier.in)
 * in parallel (~0.5s total), with background self-healing upsert.
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
          item_id: r.item_id.startsWith("storage-") ? r.item_id : `storage-${isStore2 ? "2" : "1"}-${r.item_id.replace(/^personal-/, "")}`,
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

/**
 * Warms up the enterprise shared data storage cache asynchronously in the background.
 */
export function warmupSharedDataStorage(): void {
  if (!isAzureConfigured()) {
    return;
  }
  const now = Date.now();
  for (const acc of SHARED_DATA_STORAGE_ACCOUNTS) {
    const norm = acc.toLowerCase();
    const lastSync = activeBackgroundSyncs.get(norm);
    const isSyncActive = lastSync !== undefined && now - lastSync < BACKGROUND_SYNC_TIMEOUT_MS;
    if (!userDriveCache.has(norm) && !isSyncActive) {
      activeBackgroundSyncs.set(norm, now);
      fetchUserDriveItems(norm)
        .then(() => console.log(`[Shared Storage] Cache warmed up for ${acc}`))
        .catch((err) => console.warn(`[Shared Storage] Warmup failed for ${acc}:`, err))
        .finally(() => activeBackgroundSyncs.delete(norm));
    }
  }
}
