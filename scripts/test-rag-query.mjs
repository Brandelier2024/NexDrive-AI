import fs from "fs";
import path from "path";

const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const idx = trimmed.indexOf("=");
      if (idx > -1) {
        process.env[trimmed.substring(0, idx).trim()] = trimmed.substring(idx + 1).trim();
      }
    }
  }
}

async function run() {
  const { searchOneDriveItems, groupItemsByFolder } = await import("../src/lib/retrieval/retriever.ts");
  const { generateRagAnswer } = await import("../src/lib/generation/rag-chain.ts");

  for (const query of ["Barjockey Pisco", "Barjockey in October", "Dinesh edits"]) {
    console.log(`\n======================================================`);
    console.log(`TEST QUERY: "${query}"`);
    console.log(`======================================================`);

    const records = await searchOneDriveItems(query);
    const folderCards = groupItemsByFolder(records);

    console.log(`Matched records: ${records.length}`);
    console.log(`Folder cards: ${folderCards.length}`);

    if (folderCards.length > 0) {
      const top = folderCards[0];
      console.log(`Top match folder: ${top.folder_path}`);
      console.log(`Folder link: ${top.folder_web_url}`);
      if (top.matched_files.length > 0) {
        console.log(`Files inside (${top.matched_files.length}):`, top.matched_files.map(f => `${f.name} -> ${f.file_web_url}`));
      }
    }

    const answer = await generateRagAnswer(query, records, folderCards);
    console.log("\nGenerated Answer:\n" + answer);
  }
}

run().catch(console.error);
