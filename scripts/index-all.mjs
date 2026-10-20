import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

// 1. Load .env.local
const envPath = path.resolve(process.cwd(), ".env.local");
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const idx = trimmed.indexOf("=");
      if (idx > -1) {
        env[trimmed.substring(0, idx).trim()] = trimmed.substring(idx + 1).trim();
      }
    }
  }
}

const {
  AZURE_TENANT_ID,
  AZURE_CLIENT_ID,
  AZURE_CLIENT_SECRET,
  ONEDRIVE_DRIVE_ID,
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = env;

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function cleanFolderPath(rawPath) {
  if (!rawPath) return "Root";
  return rawPath
    .replace(/^\/drives\/[^/]+\/root:?/, "")
    .replace(/^\/drive\/root:?/, "")
    .replace(/^\/+/, "") || "Root";
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "heic", "raw"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "avi", "mkv", "wmv", "m4v", "webm"]);

function determineRecordType(item) {
  if (item.folder) return "folder";
  const ext = item.name?.split(".").pop()?.toLowerCase() || "";
  if (item.image || IMAGE_EXTENSIONS.has(ext)) return "image";
  if (item.video || VIDEO_EXTENSIONS.has(ext)) return "video";
  return null;
}

function generateDeterministicVector(text, dimensions = 768) {
  const vector = new Array(dimensions).fill(0);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = (hash << 5) - hash + word.charCodeAt(i);
      hash |= 0;
    }
    const idx = Math.abs(hash) % dimensions;
    vector[idx] += 1.0;
    const secondaryIdx = Math.abs((hash * 31) + 17) % dimensions;
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

async function runFullIndex() {
  console.log("==================================================");
  console.log("Starting Full SharePoint Drive Index (31,000+ files)...");
  console.log("==================================================");
  const startTime = Date.now();

  // 1. Get Token
  console.log("1. Authenticating with Azure AD...");
  const tokenUrl = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: AZURE_CLIENT_ID,
    client_secret: AZURE_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const { access_token } = await tokenRes.json();
  const headers = { Authorization: `Bearer ${access_token}` };

  // 2. Crawl all pages
  console.log("2. Fetching metadata pages from Microsoft Graph...");
  let nextUrl = `https://graph.microsoft.com/v1.0/drives/${ONEDRIVE_DRIVE_ID}/root/delta?$select=id,name,webUrl,folder,image,video,file,parentReference,lastModifiedDateTime`;
  const rawItems = [];
  let finalDeltaLink = null;
  let page = 0;

  while (nextUrl) {
    let attempts = 0;
    let res = null;
    while (attempts < 5) {
      res = await fetch(nextUrl, { headers });
      if (res.status === 429) {
        attempts++;
        const retryAfter = parseInt(res.headers.get("Retry-After") || "5", 10);
        console.warn(`[Graph API] Rate limited (429). Retrying in ${retryAfter}s (attempt ${attempts}/5)...`);
        await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
      } else {
        break;
      }
    }

    if (!res || !res.ok) {
      console.error(`Page ${page + 1} error:`, res?.status, await res?.text());
      break;
    }

    page++;
    const data = await res.json();
    if (data.value && data.value.length > 0) {
      rawItems.push(...data.value);
    }

    if (page % 10 === 0 || !data["@odata.nextLink"]) {
      console.log(`   Page ${page}: ${rawItems.length} items collected so far...`);
    }

    nextUrl = data["@odata.nextLink"] || null;
    if (data["@odata.deltaLink"]) {
      finalDeltaLink = data["@odata.deltaLink"];
    }

    if (nextUrl) {
      // 250ms spacing between pages to prevent Microsoft Graph rate limit
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  console.log(`\n✅ Graph API scan complete! Total items collected: ${rawItems.length} across ${page} pages.`);

  // 3. Build Folder Lookup Map
  console.log("3. Building folder hierarchy map...");
  const folderMap = new Map();
  for (const item of rawItems) {
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

  // 4. Transform into searchable records with embeddings
  console.log("4. Preparing media & folder records with 768-dim embeddings...");
  const recordMap = new Map();
  for (const item of rawItems) {
    const recordType = determineRecordType(item);
    if (!recordType) continue; // skip non-media files

    const parentId = item.parentReference?.id ?? null;
    const parentFolderInfo = parentId ? folderMap.get(parentId) : undefined;
    const parentName = parentFolderInfo?.name ?? null;
    const folderWebUrl = recordType === "folder" ? item.webUrl : parentFolderInfo?.webUrl || item.webUrl;
    const folderPath = recordType === "folder"
      ? folderMap.get(item.id)?.path || cleanFolderPath(item.parentReference?.path)
      : parentFolderInfo?.path || cleanFolderPath(item.parentReference?.path);

    const cleanName = item.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
    const summary = recordType === "folder"
      ? `Folder "${item.name}" at ${folderPath}`
      : `Media asset "${cleanName}" in ${folderPath}`;
    const tags = `${folderPath} ${cleanName}`.toLowerCase().replace(/[^a-z0-9]+/g, ", ");

    const textToEmbed = `Path: ${folderPath} | Folder: ${parentName || item.name} | Name: ${item.name} | Type: ${recordType} | Summary: ${summary} | Tags: ${tags}`;
    const embedding = generateDeterministicVector(textToEmbed, 768);

    recordMap.set(item.id, {
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
      visual_summary: summary,
      visual_tags: tags,
      last_modified: item.lastModifiedDateTime || new Date().toISOString(),
      embedding,
      updated_at: new Date().toISOString(),
    });
  }

  const records = Array.from(recordMap.values());
  console.log(`✅ Prepared ${records.length} unique records (${records.filter(r => r.record_type === 'folder').length} folders, ${records.filter(r => r.record_type !== 'folder').length} media files).`);

  // 5. Upsert to Supabase in chunks of 500
  console.log("5. Saving records to Supabase PostgreSQL database in batches of 500...");
  const CHUNK_SIZE = 500;
  let savedCount = 0;

  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from("onedrive_items").upsert(chunk, { onConflict: "item_id" });
    if (error) {
      console.warn(`Chunk ${i} warning:`, error.message);
    } else {
      savedCount += chunk.length;
      console.log(`   Saved ${savedCount}/${records.length} items (${Math.round((savedCount / records.length) * 100)}%)...`);
    }
  }

  // 6. Save final deltaLink into sync_state
  if (finalDeltaLink) {
    console.log("6. Storing @odata.deltaLink for future add-on only syncs...");
    await supabase.from("sync_state").upsert({
      id: "default",
      delta_link: finalDeltaLink,
      last_sync_at: new Date().toISOString(),
      items_synced: savedCount,
    });
    console.log("✅ State saved!");
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("==================================================");
  console.log(`🎉 FULL INDEX COMPLETE in ${durationSec}s!`);
  console.log(`Total items indexed: ${savedCount}`);
  console.log("All future syncs will be add-on only using deltaLink!");
  console.log("==================================================");
}

runFullIndex().catch(console.error);
