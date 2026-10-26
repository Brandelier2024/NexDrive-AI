import { NextResponse } from "next/server";
import crypto from "crypto";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/config";
import { createServerSupabaseClient } from "@/lib/supabase";
import { syncMasterEditsSheet } from "@/lib/crawler/master-edits-sync";

export const maxDuration = 120;

const LOCK_ID = "master_edits_sync_lock";
const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5-minute lock expiration to prevent deadlocks

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isAdminUser(session.user.email)) {
      return NextResponse.json(
        { error: "Forbidden: Administrative privileges required to trigger Master Edits synchronization." },
        { status: 403 }
      );
    }

    const supabase = createServerSupabaseClient();
    const ownerToken = crypto.randomUUID();
    const expiredThreshold = new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString();

    // 1. Ensure the lock row exists idempotently
    await supabase
      .from("sync_state")
      .upsert(
        { id: LOCK_ID, delta_link: "idle", last_sync_at: new Date(0).toISOString() },
        { onConflict: "id", ignoreDuplicates: true }
      )
      .throwOnError();

    // 2. Atomically acquire lock using conditional database update
    const { data: acquiredRows } = await supabase
      .from("sync_state")
      .update({
        delta_link: ownerToken,
        last_sync_at: new Date().toISOString(),
      })
      .eq("id", LOCK_ID)
      .or(`delta_link.eq.idle,last_sync_at.lt.${expiredThreshold}`)
      .select("id, delta_link, last_sync_at")
      .throwOnError();

    // Prevent sync startup unless acquisition succeeds
    if (!acquiredRows || acquiredRows.length === 0) {
      return NextResponse.json(
        { error: "A Master Edits sheet sync is already running in background." },
        { status: 429 }
      );
    }

    // 3. Execute sync and release lock only if owned by this ownerToken
    let syncErr: unknown = null;
    try {
      const result = await syncMasterEditsSheet();
      return NextResponse.json(result);
    } catch (err) {
      syncErr = err;
      throw err;
    } finally {
      try {
        await supabase
          .from("sync_state")
          .update({
            delta_link: "idle",
            last_sync_at: new Date().toISOString(),
          })
          .eq("id", LOCK_ID)
          .eq("delta_link", ownerToken)
          .throwOnError();
      } catch (releaseErr) {
        if (!syncErr) {
          throw releaseErr;
        } else {
          console.error(
            "[MasterEdits API Error] Failed to release sync lock following sync error:",
            releaseErr
          );
        }
      }
    }
  } catch (err: unknown) {
    console.error("[MasterEdits API Error]:", err);
    return NextResponse.json(
      { error: "Master Edits synchronization failed. Please check server logs for details." },
      { status: 500 }
    );
  }
}
