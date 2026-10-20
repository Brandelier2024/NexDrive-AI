import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

// Load .env.local
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
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = env;

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function testIncrementalSync() {
  console.log("==================================================");
  console.log("Testing Incremental Delta Sync (Add-on Only)...");
  console.log("==================================================");
  const startTime = Date.now();

  // 1. Fetch saved deltaLink from Supabase
  const { data: syncState } = await supabase
    .from("sync_state")
    .select("*")
    .eq("id", "default")
    .single();

  console.log("1. Retrieved sync state from Supabase:");
  console.log(`   Items in DB: ${syncState.items_synced}`);
  console.log(`   Last Sync At: ${syncState.last_sync_at}`);
  console.log(`   Has Delta Token: ${Boolean(syncState.delta_link)}`);

  if (!syncState.delta_link) {
    throw new Error("No delta_link found! Initial full crawl is required.");
  }

  // 2. Authenticate
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

  // 3. Query Microsoft Graph with delta token
  console.log("\n2. Querying Microsoft Graph with delta token...");
  const t0 = Date.now();
  const deltaRes = await fetch(syncState.delta_link, {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!deltaRes.ok) {
    throw new Error(`Graph delta query failed: ${deltaRes.status} ${await deltaRes.text()}`);
  }

  const deltaData = await deltaRes.json();
  const queryDuration = ((Date.now() - t0) / 1000).toFixed(2);
  const changedItems = deltaData.value || [];

  console.log(`✅ Delta check returned in ${queryDuration}s!`);
  console.log(`   New / Changed items since last sync: ${changedItems.length}`);
  console.log(`   New delta token received: ${Boolean(deltaData["@odata.deltaLink"])}`);

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log("==================================================");
  console.log(`🎉 Incremental sync completed in ${totalDuration}s!`);
  console.log("Zero files re-scanned. Only delta add-ons checked.");
  console.log("==================================================");
}

testIncrementalSync().catch(console.error);
