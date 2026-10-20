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

const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

async function testSearch(query) {
  console.log(`\n==================================================`);
  console.log(`Searching for: "${query}"`);
  console.log(`==================================================`);

  // 1. Text-based ILIKE search
  const { data: textResults } = await supabase
    .from("onedrive_items")
    .select("item_id, name, record_type, folder_path, folder_web_url, file_web_url")
    .or(`name.ilike.%${query}%,folder_path.ilike.%${query}%,visual_tags.ilike.%${query}%`)
    .limit(5);

  console.log(`Found ${textResults?.length || 0} direct matches:`);
  for (const r of (textResults || [])) {
    console.log(`- [${r.record_type.toUpperCase()}] ${r.name}`);
    console.log(`  Folder: ${r.folder_path}`);
    console.log(`  Folder URL: ${r.folder_web_url}`);
    if (r.file_web_url) console.log(`  File URL: ${r.file_web_url}`);
  }

  // 2. Vector search via match_onedrive_items RPC
  const vector = generateDeterministicVector(query, 768);
  const { data: vectorResults, error } = await supabase.rpc("match_onedrive_items", {
    query_embedding: vector,
    match_threshold: 0.1,
    match_count: 5,
  });

  if (error) {
    console.log("Vector RPC notice:", error.message);
  } else {
    console.log(`\nVector similarity matches: ${vectorResults?.length || 0}`);
    for (const r of (vectorResults || [])) {
      console.log(`- [${r.record_type.toUpperCase()}] ${r.name} (similarity: ${r.similarity?.toFixed(3)})`);
      console.log(`  Folder: ${r.folder_path}`);
      console.log(`  Folder URL: ${r.folder_web_url}`);
    }
  }
}

async function main() {
  await testSearch("Shakti Kale");
  await testSearch("Barjockey");
}

main().catch(console.error);
