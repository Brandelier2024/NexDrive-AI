import fs from "fs";
import path from "path";

// Load .env.local into process.env
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const idx = trimmed.indexOf("=");
      if (idx > -1) {
        const key = trimmed.substring(0, idx).trim();
        const val = trimmed.substring(idx + 1).trim();
        process.env[key] = val;
      }
    }
  }
}

const { syncOneDrive } = await import("../src/lib/crawler/indexer.ts");

console.log("Starting sync benchmark...");
const start = Date.now();

syncOneDrive().then((res) => {
  const duration = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`\n🎉 Sync completed in ${duration}s:`, res);
  process.exit(0);
}).catch((err) => {
  console.error("Sync error:", err);
  process.exit(1);
});
