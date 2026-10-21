import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncMasterEditsSheet } from "@/lib/crawler/master-edits-sync";

let isSyncRunning = false;

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (isSyncRunning) {
      return NextResponse.json(
        { error: "A Master Edits sheet sync is already running in background." },
        { status: 429 }
      );
    }

    isSyncRunning = true;
    try {
      const result = await syncMasterEditsSheet();
      return NextResponse.json(result);
    } finally {
      isSyncRunning = false;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Sync failed";
    console.error("[MasterEdits API Error]:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
