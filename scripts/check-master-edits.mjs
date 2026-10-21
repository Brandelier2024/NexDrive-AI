import fs from "fs";
import path from "path";

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

const { AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, ONEDRIVE_DRIVE_ID } = env;

async function check() {
  console.log("==================================================");
  console.log("Checking Company Shared Documents for Master Edits Sheet...");
  console.log("Drive ID:", ONEDRIVE_DRIVE_ID);
  console.log("==================================================");

  // 1. Get Graph Access Token
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

  if (!tokenRes.ok) {
    console.error("❌ Token Error:", await tokenRes.text());
    return;
  }

  const { access_token } = await tokenRes.json();
  const headers = { Authorization: `Bearer ${access_token}` };

  // 2. Search root children or search query
  console.log("\nSearching for files with 'MASTER' or 'EDIT' or '.xlsx'...");
  const rootUrl = `https://graph.microsoft.com/v1.0/drives/${ONEDRIVE_DRIVE_ID}/root/children?$top=100`;
  const rootRes = await fetch(rootUrl, { headers });

  if (!rootRes.ok) {
    console.error("❌ Drive Root Error:", await rootRes.text());
    return;
  }

  const rootData = await rootRes.json();
  const files = rootData.value || [];
  console.log(`Found ${files.length} item(s) in root of Shared Documents:`);

  let masterFile = null;
  for (const f of files) {
    const isXlsx = f.name.toLowerCase().endsWith(".xlsx");
    const isMatch = f.name.toLowerCase().includes("master") || f.name.toLowerCase().includes("edit");
    console.log(`- [${f.folder ? "FOLDER" : "FILE"}] ${f.name} (id: ${f.id})`);
    if (isXlsx || isMatch) {
      masterFile = f;
    }
  }

  if (!masterFile) {
    console.log("\n⚠️ No 'BRANDELIER MASTER EDITS.xlsx' found in root yet.");
    console.log("Tip: If it was placed inside a subfolder, please let us know the subfolder path!");
    return;
  }

  console.log(`\n🎉 Found candidate file: ${masterFile.name} (id: ${masterFile.id})`);
  console.log(`Web URL: ${masterFile.webUrl}`);

  // Test reading worksheets
  const wsUrl = `https://graph.microsoft.com/v1.0/drives/${ONEDRIVE_DRIVE_ID}/items/${masterFile.id}/workbook/worksheets`;
  const wsRes = await fetch(wsUrl, { headers });
  if (wsRes.ok) {
    const wsData = await wsRes.json();
    console.log("\n📑 Worksheets found in workbook:");
    for (const ws of wsData.value || []) {
      console.log(`  - Sheet: "${ws.name}" (id: ${ws.id})`);
    }
  } else {
    console.log("\nNote on Workbook API:", wsRes.status, await wsRes.text());
    console.log("We can also download the raw .xlsx buffer directly via /content endpoint!");
  }
}

check().catch(console.error);
