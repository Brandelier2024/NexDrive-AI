import { NextResponse } from "next/server";
import { syncOneDrive, getAllIndexedRecords } from "@/lib/crawler/indexer";
import { isAzureConfigured } from "@/lib/graph/auth";
import { isGeminiConfigured } from "@/lib/crawler/vision-describer";
import { auth } from "@/lib/auth";

let isSyncInProgress = false;

export async function POST(req: Request) {
  try {
    const session = await auth();
    // Allow sync if authenticated
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (isSyncInProgress) {
      return NextResponse.json(
        { success: false, error: "A sync is already actively running. Please wait for it to finish." },
        { status: 429 }
      );
    }

    isSyncInProgress = true;
    try {
      const result = await syncOneDrive();
      return NextResponse.json(result);
    } finally {
      isSyncInProgress = false;
    }
  } catch (error: any) {
    console.error("[Sync API Error]:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Sync failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
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
  } catch (error: any) {
    return NextResponse.json(
      { status: "error", error: error?.message || "Status check failed" },
      { status: 500 }
    );
  }
}
