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

const { crawlOneDriveDelta } = await import("../src/lib/crawler/onedrive-crawler.ts");
const { upsertOneDriveRecords } = await import("../src/lib/crawler/indexer.ts");

console.log("1. Starting crawlOneDriveDelta...");
const t0 = Date.now();
const crawlResult = await crawlOneDriveDelta(null);
console.log(`Crawl done in ${((Date.now() - t0) / 1000).toFixed(2)}s. Items to upsert: ${crawlResult.recordsToUpsert.length}`);

console.log("2. Starting upsertOneDriveRecords...");
const t1 = Date.now();
const count = await upsertOneDriveRecords(crawlResult.recordsToUpsert);
console.log(`Upsert done in ${((Date.now() - t1) / 1000).toFixed(2)}s. Total count: ${count}`);

console.log(`\n🎉 Total elapsed time: ${((Date.now() - t0) / 1000).toFixed(2)}s`);
process.exit(0);
