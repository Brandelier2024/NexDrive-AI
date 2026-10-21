import fs from "fs";
import path from "path";

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

const { AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET } = env;

async function run() {
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

  const driveId = "b!4UkkSUBb7EONrBN-9t-yC8G83OVLLPVNki85r7d7cjAJTTBA0NswRoLhu1Ogh6mk";
  const itemId = "01WWQKDCQM3M6Q7CFNNJH2HDSBDPJCWXQJ";

  const wsUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets`;
  const wsRes = await fetch(wsUrl, { headers });
  const wsData = await wsRes.json();
  const sheets = wsData.value || [];

  console.log(`Workbook has ${sheets.length} sheets total.`);
  console.log("Analyzing all sheets...\n");

  const summary = [];
  for (const sheet of sheets) {
    const rangeUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets('${encodeURIComponent(sheet.name)}')/usedRange`;
    const rangeRes = await fetch(rangeUrl, { headers });
    if (!rangeRes.ok) {
      console.log(`Failed to fetch sheet "${sheet.name}":`, rangeRes.status);
      continue;
    }
    const rangeData = await rangeRes.json();
    const rows = rangeData.values || [];
    const header = rows[0] || [];
    // Filter non-empty headers
    const cleanHeader = header.map(h => String(h || "").trim()).filter(Boolean);
    summary.push({
      name: sheet.name,
      rowCount: rows.length,
      headers: cleanHeader
    });
    console.log(`Sheet: "${sheet.name}" | Rows: ${rows.length} | Columns: ${cleanHeader.join(", ")}`);
  }

  console.log("\nSummary collected for all sheets.");
}

run().catch(console.error);
