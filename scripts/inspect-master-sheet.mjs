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

  // Test reading usedRange for Oct 2026 and Client allocations
  for (const sheetName of ["Oct 2026", "Oct 25", "Client allocations"]) {
    console.log(`\n======================================`);
    console.log(`Reading Sheet: "${sheetName}"`);
    console.log(`======================================`);
    const rangeUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets('${encodeURIComponent(sheetName)}')/usedRange`;
    const rangeRes = await fetch(rangeUrl, { headers });
    if (rangeRes.ok) {
      const rangeData = await rangeRes.json();
      const values = rangeData.values || [];
      console.log(`Total rows in usedRange: ${values.length}`);
      if (values.length > 0) {
        console.log("Header row (row 0):", values[0]);
        if (values.length > 1) {
          console.log("Sample row 1:", values[1]);
        }
        if (values.length > 2) {
          console.log("Sample row 2:", values[2]);
        }
      }
    } else {
      console.log(`Error reading sheet "${sheetName}":`, rangeRes.status, await rangeRes.text());
    }
  }
}

run().catch(console.error);
