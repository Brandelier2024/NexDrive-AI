import ExcelJS from "exceljs";
import { config } from "@/lib/config";
import { createServerSupabaseClient } from "@/lib/supabase";
import {
  extractCell,
  extractHeaderCell,
  generateMasterEditId,
} from "./master-edits-parser.mjs";

const DRIVE_ID = "b!4UkkSUBb7EONrBN-9t-yC8G83OVLLPVNki85r7d7cjAJTTBA0NswRoLhu1Ogh6mk";
const ITEM_ID = "01WWQKDCQM3M6Q7CFNNJH2HDSBDPJCWXQJ";
const MASTER_SHEET_FALLBACK_URL =
  "https://brandeliermediaworksllp-my.sharepoint.com/:x:/r/personal/rushikesh_brandelier_in/_layouts/15/Doc.aspx?sourcedoc=%7B0F3DDB0C-AD88-4F6A-A38E-411BD22B5E09%7D&file=BRANDELIER%20MASTER%20EDITS.xlsx";

function safeIsoDate(raw: string): string {
  if (!raw) return new Date().toISOString();
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return d.toISOString();
    }
  } catch {}
  return new Date().toISOString();
}

function generateDeterministicVector(text: string, dimensions = 768): number[] {
  const vector = new Array(dimensions).fill(0);
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = (hash << 5) - hash + word.charCodeAt(i);
      hash |= 0;
    }
    const idx = Math.abs(hash) % dimensions;
    vector[idx] += 1.0;
    const secondaryIdx = Math.abs(hash * 31 + 17) % dimensions;
    vector[secondaryIdx] += 0.5;
  }

  let norm = 0;
  for (let i = 0; i < dimensions; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) vector[i] /= norm;
  } else {
    vector[0] = 1.0;
  }
  return vector;
}

export interface MasterEditsSyncResult {
  success: boolean;
  totalSynced: number;
  totalFolders: number;
  totalFinalVideos: number;
  rawLinksFound: number;
  finalLinksFound: number;
  staleRecordsRemoved?: number;
  sheetsProcessed: string[];
  durationMs: number;
  error?: string;
}

export async function syncMasterEditsSheet(): Promise<MasterEditsSyncResult> {
  const startTime = Date.now();
  const sheetsProcessed: string[] = [];

  // 1. Authenticate with Azure AD
  const tokenUrl = `https://login.microsoftonline.com/${config.azure.tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: config.azure.clientId,
    client_secret: config.azure.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!tokenRes.ok) {
    throw new Error(`Failed to obtain Azure token: ${tokenRes.status} ${await tokenRes.text()}`);
  }

  const { access_token } = await tokenRes.json();

  // 2. Download Live Workbook Content
  const contentUrl = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${ITEM_ID}/content`;
  const fileRes = await fetch(contentUrl, {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!fileRes.ok) {
    throw new Error(`Failed to download master workbook: ${fileRes.status} ${await fileRes.text()}`);
  }

  const buffer = await fileRes.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  // @ts-expect-error ExcelJS supports Buffer
  await workbook.xlsx.load(Buffer.from(buffer));

  const monthSheets = [
    "JULY", "AUG", "SEP 25", "Oct 25", "NOV 25", "December 25",
    "January 2026", "February 2026", "March 2026", "Apr 2026", "May 2026",
    "April 2026", "June 2026", "July 2026", "Aug 2026", "Sept 2026", "Oct 2026"
  ];

  interface ItemRecord {
    item_id: string;
    record_type: "folder" | "video";
    name: string;
    file_web_url: string | null;
    parent_folder_id: string;
    parent_folder_name: string;
    folder_path: string;
    folder_web_url: string;
    thumbnail_url: string | null;
    media_type: string;
    visual_summary: string;
    visual_tags: string;
    last_modified: string;
    embedding: number[];
    updated_at: string;
  }

  const dbRecords: ItemRecord[] = [];
  const seenIdCounts = new Map<string, number>();
  let rawLinksFound = 0;
  let finalLinksFound = 0;

  for (const sheetName of monthSheets) {
    const ws = workbook.getWorksheet(sheetName);
    if (!ws) continue;

    sheetsProcessed.push(sheetName);

    // Detect header row
    let headerRowIdx = 1;
    let headers: string[] = [];
    for (let r = 1; r <= 4; r++) {
      const row = ws.getRow(r);
      const rowVals: string[] = [];
      row.eachCell({ includeEmpty: true }, (c, col) => {
        rowVals[col] = extractHeaderCell(c);
      });
      if (
        rowVals.some(
          (v) =>
            v.includes("client") ||
            v.includes("reel") ||
            v.includes("heading") ||
            v.includes("status") ||
            v.includes("assigned")
        )
      ) {
        headerRowIdx = r;
        headers = rowVals;
        break;
      }
    }

    let clientCol = -1;
    let headingCol = -1;
    let assignedCol = -1;
    let shootCol = -1;
    let statusCol = -1;
    let rawCol = -1;
    let finalCol = -1;
    let dateCol = -1;

    for (let c = 1; c < headers.length; c++) {
      const h = headers[c] || "";
      if (h.includes("client") || h === "brand") clientCol = c;
      else if (
        h.includes("reel") ||
        h.includes("heading") ||
        h.includes("media") ||
        h.includes("topic") ||
        h.includes("title")
      )
        headingCol = c;
      else if (h.includes("assigned")) assignedCol = c;
      else if (
        h.includes("shoot done") ||
        h.includes("shooter") ||
        h.includes("videographer")
      )
        shootCol = c;
      else if (h.includes("status")) statusCol = c;
      else if (h.includes("raw")) rawCol = c;
      else if (h.includes("final") || h.includes("edit link")) finalCol = c;
      else if (
        h.includes("shoot date") ||
        h.includes("posting date") ||
        h.includes("due date")
      ) {
        if (dateCol === -1) dateCol = c;
      }
    }

    // Pass 1: Build shoot name to URL mapping for inheritance
    const shootNameToUrl = new Map<string, string>();
    for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (rawCol !== -1) {
        const rawCell = extractCell(row.getCell(rawCol));
        if (rawCell.url && rawCell.text && rawCell.text !== rawCell.url) {
          shootNameToUrl.set(rawCell.text.toLowerCase().trim(), rawCell.url);
        }
      }
    }

    for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const client = clientCol !== -1 ? extractCell(row.getCell(clientCol)).text : "";
      const heading = headingCol !== -1 ? extractCell(row.getCell(headingCol)).text : "";
      const assignedTo = assignedCol !== -1 ? extractCell(row.getCell(assignedCol)).text : "";
      const shootDoneBy = shootCol !== -1 ? extractCell(row.getCell(shootCol)).text : "";
      const status = statusCol !== -1 ? extractCell(row.getCell(statusCol)).text : "";
      const dateVal = dateCol !== -1 ? extractCell(row.getCell(dateCol)).text : "";

      const rawData = rawCol !== -1 ? extractCell(row.getCell(rawCol)) : { text: "", url: "" };
      const finalData = finalCol !== -1 ? extractCell(row.getCell(finalCol)) : { text: "", url: "" };

      // Inherit shoot URL if text matches a known shoot
      if (!rawData.url && rawData.text) {
        const inherited = shootNameToUrl.get(rawData.text.toLowerCase().trim());
        if (inherited) {
          rawData.url = inherited;
        }
      }

      // Skip blank rows or totals
      if (!client && !heading) continue;
      const clientLower = client.toLowerCase();
      if (
        clientLower === "grand total" ||
        clientLower === "count of status" ||
        clientLower === "client" ||
        clientLower.startsWith("total")
      ) {
        continue;
      }

      if (rawData.url) rawLinksFound++;
      if (finalData.url) finalLinksFound++;

      const keyForCount = [
        sheetName.trim().toLowerCase(),
        (client || "").trim().toLowerCase(),
        (heading || "").trim().toLowerCase(),
        (rawData.url || "").trim().toLowerCase(),
        (finalData.url || "").trim().toLowerCase(),
      ].join("|");
      const occurrenceIndex = seenIdCounts.get(keyForCount) || 0;
      seenIdCounts.set(keyForCount, occurrenceIndex + 1);

      const safeSheetKey = sheetName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
      const parentFolderId = generateMasterEditId(
        sheetName,
        client,
        heading,
        rawData.url,
        finalData.url,
        occurrenceIndex
      );
      const folderWebUrl = rawData.url || finalData.url || MASTER_SHEET_FALLBACK_URL;
      const folderPath = `Master Edits / ${sheetName} / ${client || "General"} / ${heading || (occurrenceIndex > 0 ? `Item ${occurrenceIndex + 1}` : "Project")}`;

      const summaryParts = [
        `[Master Edit Sheet: ${sheetName}]`,
        `Client: "${client || "General"}"`,
        `Project / Reel: "${heading || "Untitled"}"`,
        assignedTo ? `Assigned Editor: "${assignedTo}"` : null,
        shootDoneBy ? `Shooter / Videographer: "${shootDoneBy}"` : null,
        status ? `Status: "${status}"` : null,
        dateVal ? `Date: "${dateVal}"` : null,
        rawData.url ? `Raw Data Folder: "${rawData.url}"` : `Raw Data: Not linked in sheet`,
        finalData.url ? `Final Edit Video: "${finalData.url}"` : `Final Edit: Not linked in sheet`,
      ].filter(Boolean);

      const visualSummary = summaryParts.join(" | ");
      const visualTags = [
        client,
        heading,
        assignedTo,
        shootDoneBy,
        status,
        sheetName,
        "master edit",
        "master edit sheet",
        "raw data",
        "final edit",
        "reel",
        "video",
      ]
        .filter(Boolean)
        .join(", ")
        .toLowerCase();

      const textToEmbed = `Sheet: ${sheetName} | Client: ${client} | Project: ${heading} | Editor: ${assignedTo} | Shooter: ${shootDoneBy} | Status: ${status} | Summary: ${visualSummary} | Tags: ${visualTags}`;
      const embedding = generateDeterministicVector(textToEmbed, 768);

      // Primary Folder Record
      dbRecords.push({
        item_id: parentFolderId,
        record_type: "folder",
        name: `[${sheetName}] ${client || "Project"} - ${heading || (occurrenceIndex > 0 ? `Item ${occurrenceIndex + 1}` : "Project")}${assignedTo ? ` (${assignedTo})` : ""}`,
        file_web_url: null,
        parent_folder_id: `master_edits_${safeSheetKey}`,
        parent_folder_name: `Master Edits - ${sheetName}`,
        folder_path: folderPath,
        folder_web_url: folderWebUrl,
        thumbnail_url: null,
        media_type: "folder",
        visual_summary: visualSummary,
        visual_tags: visualTags,
        last_modified: safeIsoDate(dateVal),
        embedding,
        updated_at: new Date().toISOString(),
      });

      // Child Final Edit Video Record (if distinct final link exists)
      if (finalData.url && finalData.url !== rawData.url) {
        const videoName = finalData.text || `${heading || client} (Final Export)`;
        const videoSummary = `Final edit deliverable for "${client} - ${heading}". Editor: ${assignedTo || "Unassigned"}. Status: ${status || "Complete"}. Direct Video Link: ${finalData.url}`;
        const videoTags = `${client}, ${heading}, ${assignedTo}, final edit, video, export, mp4`.toLowerCase();
        const videoEmbedding = generateDeterministicVector(`${textToEmbed} | Final Edit Video: ${videoName}`, 768);

        dbRecords.push({
          item_id: `${parentFolderId}_final`,
          record_type: "video",
          name: videoName,
          file_web_url: finalData.url,
          parent_folder_id: parentFolderId,
          parent_folder_name: `[${sheetName}] ${client} - ${heading}`,
          folder_path: folderPath,
          folder_web_url: folderWebUrl,
          thumbnail_url: null,
          media_type: "video/mp4",
          visual_summary: videoSummary,
          visual_tags: videoTags,
          last_modified: new Date().toISOString(),
          embedding: videoEmbedding,
          updated_at: new Date().toISOString(),
        });
      }
    }
  }

  // Upsert into Supabase in batches of 200
  const supabase = createServerSupabaseClient();
  const BATCH_SIZE = 200;
  let saved = 0;
  const upsertErrors: string[] = [];

  for (let i = 0; i < dbRecords.length; i += BATCH_SIZE) {
    const chunk = dbRecords.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("onedrive_items")
      .upsert(chunk, { onConflict: "item_id" });

    if (error) {
      console.error(`[MasterEditsSync] Upsert error at batch ${i}:`, error.message);
      upsertErrors.push(`Batch ${i}: ${error.message}`);
    } else {
      saved += chunk.length;
    }
  }

  // 5. Cleanup stale onedrive_items records matching master_edit_% not in current run
  const currentItemIds = new Set(dbRecords.map((r) => r.item_id));
  let staleRecordsRemoved = 0;

  try {
    const existingIds: string[] = [];
    let page = 0;
    const PAGE_SIZE = 1000;

    while (true) {
      const { data, error: fetchErr } = await supabase
        .from("onedrive_items")
        .select("item_id")
        .like("item_id", "master_edit_%")
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (fetchErr || !data || data.length === 0) break;
      for (const row of data) {
        existingIds.push(row.item_id);
      }
      if (data.length < PAGE_SIZE) break;
      page++;
    }

    if (existingIds.length > 0) {
      const idsToDelete = existingIds.filter((id) => !currentItemIds.has(id));

      if (idsToDelete.length > 0) {
        const DELETE_CHUNK = 200;
        for (let i = 0; i < idsToDelete.length; i += DELETE_CHUNK) {
          const chunk = idsToDelete.slice(i, i + DELETE_CHUNK);
          const { error: delErr } = await supabase
            .from("onedrive_items")
            .delete()
            .in("item_id", chunk);

          if (!delErr) {
            staleRecordsRemoved += chunk.length;
          } else {
            console.warn("[MasterEditsSync] Delete batch error:", delErr.message);
          }
        }
      }
    }
  } catch (cleanErr) {
    console.warn("[MasterEditsSync] Stale records cleanup error:", cleanErr);
  }

  return {
    success: upsertErrors.length === 0,
    totalSynced: saved,
    totalFolders: dbRecords.filter((r) => r.record_type === "folder").length,
    totalFinalVideos: dbRecords.filter((r) => r.record_type === "video").length,
    rawLinksFound,
    finalLinksFound,
    staleRecordsRemoved,
    sheetsProcessed,
    durationMs: Date.now() - startTime,
    ...(upsertErrors.length > 0 ? { error: upsertErrors.join("; ") } : {}),
  };
}
