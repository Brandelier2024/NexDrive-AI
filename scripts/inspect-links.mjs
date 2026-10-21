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

  for (const sheetName of ["Oct 25", "NOV 25", "JULY", "January 2026"]) {
    console.log(`\n=================== SHEET: ${sheetName} ===================`);
    const rangeUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets('${encodeURIComponent(sheetName)}')/usedRange`;
    const res = await fetch(rangeUrl, { headers });
    if (!res.ok) {
      console.log(`Sheet ${sheetName} failed:`, res.status);
      continue;
    }
    const data = await res.json();
    const values = data.values || [];
    const formulas = data.formulas || [];
    const headerRow = values[0] || [];

    console.log("Headers:", headerRow);

    // Find indices for raw data and final edit
    let rawIdx = -1;
    let finalIdx = -1;
    let clientIdx = -1;
    let headingIdx = -1;
    let assignedIdx = -1;
    let statusIdx = -1;

    headerRow.forEach((h, idx) => {
      const col = String(h || "").trim().toLowerCase();
      if (col.includes("raw")) rawIdx = idx;
      if (col.includes("final") || col.includes("edit link")) finalIdx = idx;
      if (col.includes("client") || col === "brand") clientIdx = idx;
      if (col.includes("reel") || col.includes("heading") || col.includes("media") || col.includes("topic")) headingIdx = idx;
      if (col.includes("assigned")) assignedIdx = idx;
      if (col.includes("status")) statusIdx = idx;
    });

    console.log({ rawIdx, finalIdx, clientIdx, headingIdx, assignedIdx, statusIdx });

    let linkCount = 0;
    for (let i = 1; i < values.length; i++) {
      const rowV = values[i];
      const rowF = formulas[i];
      const rawVal = rawIdx !== -1 ? rowV[rawIdx] : "";
      const rawForm = rawIdx !== -1 ? rowF[rawIdx] : "";
      const finalVal = finalIdx !== -1 ? rowV[finalIdx] : "";
      const finalForm = finalIdx !== -1 ? rowF[finalIdx] : "";

      if (rawVal || rawForm || finalVal || finalForm) {
        linkCount++;
        if (linkCount <= 4) {
          console.log(`Row ${i}:`);
          console.log(`  Client: "${rowV[clientIdx]}" | Heading: "${rowV[headingIdx]}" | Assigned: "${rowV[assignedIdx]}" | Status: "${rowV[statusIdx]}"`);
          console.log(`  Raw Val:`, rawVal, `Raw Formula:`, rawForm);
          console.log(`  Final Val:`, finalVal, `Final Formula:`, finalForm);
        }
      }
    }
    console.log(`Sheet ${sheetName} has ${linkCount} rows with links out of ${values.length - 1} rows.`);
  }
}

run().catch(console.error);
