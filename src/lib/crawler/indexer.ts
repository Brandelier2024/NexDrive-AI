import { createServerSupabaseClient } from "@/lib/supabase";
import { OneDriveRecord, SyncResult } from "@/lib/types";
import {
  buildEmbeddingInputText,
  getEmbedding,
  generateDeterministicVector,
} from "@/lib/retrieval/embeddings";
import { MOCK_ONEDRIVE_ITEMS } from "./mock-data";
import { crawlOneDriveDelta } from "./onedrive-crawler";
import { isAzureConfigured } from "@/lib/graph/auth";
import { isGeminiConfigured } from "./vision-describer";

// In-memory fallback cache for development when Supabase is not yet set up
let inMemoryStore: OneDriveRecord[] = [];

/**
 * Returns currently indexed items (from Supabase, or in-memory fallback)
 */
export async function getAllIndexedRecords(): Promise<OneDriveRecord[]> {
  try {
    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("onedrive_items")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data && data.length > 0) {
      return data as OneDriveRecord[];
    }
  } catch (err) {
    console.warn("[Indexer] Supabase read failed, checking in-memory cache:", err);
  }

  // Fallback to in-memory store (or initialize with mock data if empty)
  if (inMemoryStore.length === 0) {
    await seedMockData();
  }
  return inMemoryStore;
}

/**
 * Upserts OneDrive records (Folders and Media) into Supabase with vector embeddings
 */
export async function upsertOneDriveRecords(
  records: OneDriveRecord[]
): Promise<number> {
  const preparedRecords: OneDriveRecord[] = [];
  const enableGemini = isGeminiConfigured();

  // 1. Compute embeddings
  if (enableGemini) {
    const BATCH_SIZE = 15;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const chunk = records.slice(i, i + BATCH_SIZE);
      const chunkResults = await Promise.all(
        chunk.map(async (record) => {
          const textToEmbed = buildEmbeddingInputText(record);
          const embedding = await getEmbedding(textToEmbed);
          return {
            ...record,
            embedding,
          };
        })
      );
      preparedRecords.push(...chunkResults);
    }
  } else {
    // Ultra-fast local hash vector calculation for 20,000+ items (under 1s)
    for (const record of records) {
      const textToEmbed = buildEmbeddingInputText(record);
      const embedding = generateDeterministicVector(textToEmbed, 768);
      preparedRecords.push({
        ...record,
        embedding,
      });
    }
  }

  // 2. Batch upsert into Supabase in chunks of 500
  // Deduplicate by item_id before batching to prevent Postgres "ON CONFLICT DO UPDATE cannot affect row a second time"
  const uniqueRecordsMap = new Map<string, OneDriveRecord>();
  for (const r of preparedRecords) {
    uniqueRecordsMap.set(r.item_id, r);
  }
  const uniqueRecords = Array.from(uniqueRecordsMap.values());

  try {
    const supabase = createServerSupabaseClient();
    const CHUNK_SIZE = 500;

    for (let i = 0; i < uniqueRecords.length; i += CHUNK_SIZE) {
      const slice = uniqueRecords.slice(i, i + CHUNK_SIZE);
      const { error } = await supabase.from("onedrive_items").upsert(
        slice.map((r) => ({
          item_id: r.item_id,
          record_type: r.record_type,
          name: r.name,
          file_web_url: r.file_web_url,
          parent_folder_id: r.parent_folder_id,
          parent_folder_name: r.parent_folder_name,
          folder_path: r.folder_path,
          folder_web_url: r.folder_web_url,
          thumbnail_url: r.thumbnail_url,
          media_type: r.media_type,
          visual_summary: r.visual_summary,
          visual_tags: r.visual_tags,
          last_modified: r.last_modified,
          embedding: r.embedding,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "item_id" }
      );

      if (error) {
        console.warn(`[Indexer] Supabase upsert error on chunk ${i}:`, error.message);
      } else {
        console.log(`[Indexer] Saved ${Math.min(i + CHUNK_SIZE, uniqueRecords.length)}/${uniqueRecords.length} items to database...`);
      }
    }
  } catch (err) {
    console.warn("[Indexer] Supabase connection error:", err);
  }

  // 3. Always maintain in-memory store sync for resilience
  for (const newRec of uniqueRecords) {
    const idx = inMemoryStore.findIndex((r) => r.item_id === newRec.item_id);
    if (idx >= 0) {
      inMemoryStore[idx] = newRec;
    } else {
      inMemoryStore.push(newRec);
    }
  }

  return uniqueRecords.length;
}

/**
 * Removes deleted items from vector store
 */
export async function deleteOneDriveRecords(itemIds: string[]): Promise<number> {
  if (itemIds.length === 0) return 0;

  try {
    const supabase = createServerSupabaseClient();
    await supabase.from("onedrive_items").delete().in("item_id", itemIds);
  } catch (err) {
    console.warn("[Indexer] Supabase delete error:", err);
  }

  inMemoryStore = inMemoryStore.filter((r) => !itemIds.includes(r.item_id));
  return itemIds.length;
}

/**
 * Seeds realistic mock OneDrive assets for testing
 */
export async function seedMockData(): Promise<SyncResult> {
  const startTime = Date.now();
  const count = await upsertOneDriveRecords(MOCK_ONEDRIVE_ITEMS);

  const folders = MOCK_ONEDRIVE_ITEMS.filter((r) => r.record_type === "folder").length;
  const media = MOCK_ONEDRIVE_ITEMS.filter((r) => r.record_type !== "folder").length;

  return {
    success: true,
    mode: "demo_mock",
    items_processed: count,
    folders_indexed: folders,
    media_indexed: media,
    deleted_count: 0,
    duration_ms: Date.now() - startTime,
  };
}

/**
 * Orchestrates full or incremental sync.
 * If Azure AD is configured, performs live Graph API delta crawl (strictly incremental add-ons once indexed).
 * Otherwise, indexes mock demonstration assets.
 */
export async function syncOneDrive(): Promise<SyncResult> {
  const startTime = Date.now();

  if (!isAzureConfigured()) {
    console.log("[Sync] Live Azure credentials not configured. Running in Demo / Mock Seed mode.");
    return seedMockData();
  }

  try {
    // 1. Fetch previous deltaLink from Supabase sync_state
    let previousDeltaLink: string | null = null;
    let initialIndexDone = false;
    let existingTotal = 0;

    try {
      const supabase = createServerSupabaseClient();
      const { data } = await supabase
        .from("sync_state")
        .select("delta_link, last_sync_at, items_synced")
        .eq("id", "default")
        .single();
      previousDeltaLink = data?.delta_link ?? null;
      existingTotal = data?.items_synced ?? 0;
      initialIndexDone = existingTotal > 1000;
    } catch {
      // ignore
    }

    // Safety guard: If initial full index was completed, NEVER re-crawl all 31k items from scratch!
    if (!previousDeltaLink && initialIndexDone) {
      console.warn(`[Sync] Initial index already complete (${existingTotal} items). Preserving existing index; skipping redundant full scan.`);
      return {
        success: true,
        mode: "live",
        items_processed: 0,
        folders_indexed: 0,
        media_indexed: 0,
        deleted_count: 0,
        duration_ms: Date.now() - startTime,
      };
    }

    // 2. Perform delta crawl (incremental only if previousDeltaLink is present)
    const crawlResult = await crawlOneDriveDelta(previousDeltaLink);

    // 3. Delete removed items
    const deletedCount = await deleteOneDriveRecords(crawlResult.itemIdsToDelete);

    // 4. Upsert records (only newly created or modified items)
    const processedCount = await upsertOneDriveRecords(crawlResult.recordsToUpsert);

    // 5. Update sync_state with new deltaLink, timestamp, and accurate total item count
    try {
      const supabase = createServerSupabaseClient();
      const { count } = await supabase
        .from("onedrive_items")
        .select("*", { count: "exact", head: true });

      const currentTotal = count ?? (existingTotal + processedCount - deletedCount);

      await supabase.from("sync_state").upsert({
        id: "default",
        delta_link: crawlResult.newDeltaLink || previousDeltaLink,
        last_sync_at: new Date().toISOString(),
        items_synced: currentTotal,
      });
    } catch {
      // ignore
    }

    const folders = crawlResult.recordsToUpsert.filter((r) => r.record_type === "folder").length;
    const media = crawlResult.recordsToUpsert.filter((r) => r.record_type !== "folder").length;

    return {
      success: true,
      mode: "live",
      items_processed: processedCount,
      folders_indexed: folders,
      media_indexed: media,
      deleted_count: deletedCount,
      duration_ms: Date.now() - startTime,
    };
  } catch (error: unknown) {
    console.error("[Sync] Error during OneDrive sync:", error);
    const message = error instanceof Error ? error.message : "Sync failed";
    return {
      success: false,
      mode: "live",
      items_processed: 0,
      folders_indexed: 0,
      media_indexed: 0,
      deleted_count: 0,
      duration_ms: Date.now() - startTime,
      error: message,
    };
  }
}
