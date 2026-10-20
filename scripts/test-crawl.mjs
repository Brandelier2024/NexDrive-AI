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
        const key = trimmed.substring(0, idx).trim();
        const val = trimmed.substring(idx + 1).trim();
        env[key] = val;
      }
    }
  }
}

const { AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, ONEDRIVE_DRIVE_ID } = env;

async function testCrawl() {
  console.log("--------------------------------------------------");
  console.log("Testing Live SharePoint/OneDrive Crawl...");
  console.log(`Drive ID: ${ONEDRIVE_DRIVE_ID}`);
  console.log("--------------------------------------------------");

  // 1. Get Token
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

  // 2. Query root delta
  const deltaUrl = `https://graph.microsoft.com/v1.0/drives/${ONEDRIVE_DRIVE_ID}/root/delta?$select=id,name,webUrl,folder,image,video,file,parentReference,lastModifiedDateTime`;
  let nextUrl = deltaUrl;
  let page = 0;
  let totalItems = 0;

  while (nextUrl) {
    page++;
    const res = await fetch(nextUrl, { headers });
    if (!res.ok) {
      console.log(`❌ Page ${page} failed:`, res.status);
      break;
    }
    const data = await res.json();
    const count = data.value?.length || 0;
    totalItems += count;
    if (page % 5 === 0 || !data["@odata.nextLink"]) {
      console.log(`Page ${page}: +${count} items (total: ${totalItems}). Next: ${Boolean(data["@odata.nextLink"])}`);
    }
    nextUrl = data["@odata.nextLink"] || null;
    if (data["@odata.deltaLink"]) {
      console.log("\n⭐ @odata.deltaLink received! Full initial crawl complete!");
      console.log("Delta Link:", data["@odata.deltaLink"]);
    }
    if (nextUrl) {
      await new Promise(r => setTimeout(r, 250));
    }
  }

  console.log(`\n🎉 Total items fetched across ${page} pages: ${totalItems}`);
}

testCrawl();
