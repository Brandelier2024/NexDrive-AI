import fs from "fs";
import path from "path";

// Read .env.local
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

const tenantId = env.AZURE_TENANT_ID;
const clientId = env.AZURE_CLIENT_ID;
const clientSecret = env.AZURE_CLIENT_SECRET;

console.log("--------------------------------------------------");
console.log("Testing Azure AD App Authentication...");
console.log(`Tenant ID: ${tenantId}`);
console.log(`Client ID: ${clientId}`);
console.log("--------------------------------------------------");

async function main() {
  try {
    // 1. Get Access Token via Client Credentials
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });

    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error(`❌ Token Error (${tokenRes.status}):`, err);
      return;
    }

    const tokenData = await tokenRes.json();
    const token = tokenData.access_token;
    console.log("✅ Successfully authenticated with Azure AD!");

    const headers = { Authorization: `Bearer ${token}` };

    // 2. Query all drives
    console.log("\nSearching for Drives / Document Libraries...");
    const drivesRes = await fetch("https://graph.microsoft.com/v1.0/drives", { headers });
    if (drivesRes.ok) {
      const drivesData = await drivesRes.json();
      if (drivesData.value && drivesData.value.length > 0) {
        console.log(`\n🎉 Found ${drivesData.value.length} Drive(s):`);
        for (const d of drivesData.value) {
          console.log(`\n👉 Name: ${d.name}`);
          console.log(`   Type: ${d.driveType}`);
          console.log(`   URL:  ${d.webUrl}`);
          console.log(`   ⭐ DRIVE ID: ${d.id}`);
        }
        return;
      }
    }

    // 3. Query all SharePoint sites
    console.log("Checking SharePoint Sites...");
    const sitesRes = await fetch("https://graph.microsoft.com/v1.0/sites?search=*", { headers });
    if (sitesRes.ok) {
      const sitesData = await sitesRes.json();
      if (sitesData.value && sitesData.value.length > 0) {
        console.log(`\nFound ${sitesData.value.length} SharePoint Site(s):`);
        for (const s of sitesData.value) {
          console.log(`\nSite: ${s.displayName || s.name} (${s.webUrl})`);
          // Get drives for this site
          const siteDrivesRes = await fetch(`https://graph.microsoft.com/v1.0/sites/${s.id}/drives`, { headers });
          if (siteDrivesRes.ok) {
            const sd = await siteDrivesRes.json();
            for (const d of sd.value || []) {
              console.log(`   👉 Library: ${d.name}`);
              console.log(`   ⭐ DRIVE ID: ${d.id}`);
            }
          }
        }
        return;
      }
    }

    // 4. Query users
    console.log("Checking Users / Personal Drives...");
    const usersRes = await fetch("https://graph.microsoft.com/v1.0/users", { headers });
    if (usersRes.ok) {
      const usersData = await usersRes.json();
      for (const u of usersData.value || []) {
        const uDriveRes = await fetch(`https://graph.microsoft.com/v1.0/users/${u.id}/drive`, { headers });
        if (uDriveRes.ok) {
          const ud = await uDriveRes.json();
          console.log(`\n👉 User: ${u.displayName} (${u.userPrincipalName})`);
          console.log(`   ⭐ DRIVE ID: ${ud.id}`);
          console.log(`   URL: ${ud.webUrl}`);
        }
      }
    }

  } catch (e) {
    console.error("Error:", e);
  }
}

main();
