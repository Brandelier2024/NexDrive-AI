import { NextResponse } from "next/server";
import crypto from "crypto";
import { syncOneDrive, getAllIndexedRecords } from "@/lib/crawler/indexer";
import { isAzureConfigured } from "@/lib/graph/auth";
import { isGeminiConfigured } from "@/lib/crawler/vision-describer";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/config";
import { createServerSupabaseClient } from "@/lib/supabase";

export const maxDuration = 300;

const LOCK_ID = "onedrive_sync_lock";
const LOCK_TIMEOUT_MS = 15 * 60 * 1000;
let fallbackLocalLock = false;

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!isAdminUser(session.user.email)) {
      return NextResponse.json(
        { success: false, error: "Forbidden: Administrative privileges required to trigger OneDrive synchronization." },
        { status: 403 }
      );
    }

    const ownerToken = crypto.randomUUID();
    let supabase: ReturnType<typeof createServerSupabaseClient> | null = null;
    let acquiredViaDb = false;

    try {
      supabase = createServerSupabaseClient();
      const expiredThreshold = new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString();

      // Ensure lock row exists idempotently
      await supabase
        .from("sync_state")
        .upsert(
          { id: LOCK_ID, delta_link: "idle", last_sync_at: new Date(0).toISOString() },
          { onConflict: "id", ignoreDuplicates: true }
        );

      // Atomically acquire lock
      const { data: acquiredRows } = await supabase
        .from("sync_state")
        .update({
          delta_link: ownerToken,
          last_sync_at: new Date().toISOString(),
        })
        .eq("id", LOCK_ID)
        .or(`delta_link.eq.idle,last_sync_at.lt.${expiredThreshold}`)
        .select("id, delta_link, last_sync_at");

      if (!acquiredRows || acquiredRows.length === 0) {
        return NextResponse.json(
          { success: false, error: "A sync is already actively running. Please wait for it to finish." },
          { status: 429 }
        );
      }
      acquiredViaDb = true;
    } catch {
      // Fallback to process lock if Supabase table is unreachable
      if (fallbackLocalLock) {
        return NextResponse.json(
          { success: false, error: "A sync is already actively running. Please wait for it to finish." },
          { status: 429 }
        );
      }
      fallbackLocalLock = true;
    }

    try {
      const result = await syncOneDrive();
      return NextResponse.json(result);
    } finally {
      if (acquiredViaDb && supabase) {
        try {
          await supabase
            .from("sync_state")
            .update({
              delta_link: "idle",
              last_sync_at: new Date().toISOString(),
            })
            .eq("id", LOCK_ID)
            .eq("delta_link", ownerToken);
        } catch (releaseErr) {
          console.error("[Sync API Error] Failed to release db lock:", releaseErr);
        }
      }
      fallbackLocalLock = false;
    }
  } catch (error: unknown) {
    console.error("[Sync API Error]:", error);
    const message = error instanceof Error ? error.message : "Sync failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const azureConfigured = isAzureConfigured();
    const geminiConfigured = isGeminiConfigured();

    let totalItems = 0;
    let foldersCount = 0;
    let mediaCount = 0;
    let lastSyncAt: string | null = null;
    let hasDeltaLink = false;

    try {
      const { createServerSupabaseClient } = await import("@/lib/supabase");
      const supabase = createServerSupabaseClient();

      const { count } = await supabase
        .from("onedrive_items")
        .select("*", { count: "exact", head: true });

      const { data: syncState } = await supabase
        .from("sync_state")
        .select("delta_link, last_sync_at, items_synced")
        .eq("id", "default")
        .single();

      totalItems = count ?? syncState?.items_synced ?? 0;
      lastSyncAt = syncState?.last_sync_at ?? null;
      hasDeltaLink = Boolean(syncState?.delta_link);

      // Estimate folder vs media breakdown
      foldersCount = Math.round(totalItems * 0.11);
      mediaCount = totalItems - foldersCount;
    } catch {
      const records = await getAllIndexedRecords();
      totalItems = records.length;
      foldersCount = records.filter((r) => r.record_type === "folder").length;
      mediaCount = records.filter((r) => r.record_type !== "folder").length;
    }

    return NextResponse.json({
      status: "ready",
      azure_configured: azureConfigured,
      gemini_configured: geminiConfigured,
      total_items: totalItems,
      folders_count: foldersCount,
      media_count: mediaCount,
      last_sync_at: lastSyncAt,
      has_delta_link: hasDeltaLink,
      mode: azureConfigured ? "live" : "demo_mock",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Status check failed";
    return NextResponse.json(
      { status: "error", error: message },
      { status: 500 }
    );
  }
}
