import { createClient } from "@supabase/supabase-js";
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

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

console.log("--------------------------------------------------");
console.log("Testing Supabase Database Connection...");
console.log(`URL: ${supabaseUrl}`);
console.log("--------------------------------------------------");

const supabase = createClient(supabaseUrl, serviceKey);

async function test() {
  try {
    const { data: users, error: uErr } = await supabase.from("users").select("count");
    if (uErr) {
      console.log("❌ users table check failed:", uErr.message);
    } else {
      console.log("✅ users table connected!");
    }

    const { data: items, error: iErr } = await supabase.from("onedrive_items").select("count");
    if (iErr) {
      console.log("❌ onedrive_items table check failed:", iErr.message);
    } else {
      console.log("✅ onedrive_items table connected!");
    }

    const { data: sync, error: sErr } = await supabase.from("sync_state").select("*");
    if (sErr) {
      console.log("❌ sync_state table check failed:", sErr.message);
    } else {
      console.log("✅ sync_state table connected!", sync);
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
