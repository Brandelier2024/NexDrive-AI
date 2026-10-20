import { config } from "@/lib/config";
import { FolderCard, OneDriveRecord } from "@/lib/types";
import { executeWithMultiProviderFallback } from "@/lib/llm/multi-provider";

/**
 * Formats retrieved records for the LLM prompt context
 */
export function formatRetrievedRecords(records: OneDriveRecord[]): string {
  if (records.length === 0) {
    return "No matching records found in OneDrive.";
  }

  return records
    .map((r, i) => {
      const parts = [
        `Record #${i + 1}:`,
        `Type: ${r.record_type}`,
        `Name: ${r.name}`,
        `Folder Path: ${r.folder_path}`,
        `Parent Folder URL (folder_web_url): ${r.folder_web_url}`,
      ];

      if (r.file_web_url) {
        parts.push(`File Direct URL (file_web_url): ${r.file_web_url}`);
      }
      if (r.visual_summary) {
        parts.push(`Visual Summary: ${r.visual_summary}`);
      }
      if (r.visual_tags) {
        parts.push(`Tags: ${r.visual_tags}`);
      }

      return parts.join("\n");
    })
    .join("\n\n---\n\n");
}

/**
 * Validates and filters every Markdown hyperlink in the response text against
 * the whitelist of retrieved folder_web_url and file_web_url.
 * Ensures ZERO URL hallucinations.
 */
export function validateAndSanitizeUrls(
  markdownText: string,
  retrievedRecords: OneDriveRecord[]
): string {
  // Collect all verified valid URLs
  const validUrls = new Set<string>();
  const fallbackFolderUrl = retrievedRecords[0]?.folder_web_url || "";

  for (const r of retrievedRecords) {
    if (r.folder_web_url) validUrls.add(r.folder_web_url.trim());
    if (r.file_web_url) validUrls.add(r.file_web_url.trim());
  }

  // Regex to match markdown links: [link text](url)
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

  return markdownText.replace(markdownLinkRegex, (match, linkText, url) => {
    const cleanUrl = url.trim();

    // If URL is in whitelist, keep it verbatim
    if (validUrls.has(cleanUrl)) {
      return `[${linkText}](${cleanUrl})`;
    }

    // Check if the URL might have trailing slashes or URL encoded differences
    for (const validUrl of validUrls) {
      if (
        cleanUrl.replace(/\/$/, "") === validUrl.replace(/\/$/, "") ||
        decodeURIComponent(cleanUrl) === decodeURIComponent(validUrl)
      ) {
        return `[${linkText}](${validUrl})`;
      }
    }

    // Hallucinated URL detected: replace with verified parent folder URL or remove link
    console.warn(`[URL Guardrail] Hallucinated URL detected and blocked: "${cleanUrl}"`);
    if (fallbackFolderUrl) {
      return `[${linkText}](${fallbackFolderUrl})`;
    } else {
      return linkText; // Strip invalid link completely
    }
  });
}

/**
 * Deterministic Markdown answer generator used when Gemini API is not configured
 */
export function generateDeterministicAnswer(
  query: string,
  folderCards: FolderCard[]
): string {
  if (folderCards.length === 0) {
    return "I couldn't find any matching folder or media in OneDrive for that query.";
  }

  const lines: string[] = [
    `I found **${folderCards.length} OneDrive folder${folderCards.length > 1 ? "s" : ""}** matching your search for "${query}":\n`,
  ];

  for (const card of folderCards) {
    const scopeLabel = card.is_personal ? "Personal OneDrive" : "Company OneDrive";
    const badge = card.is_personal ? " *(Personal)*" : "";
    lines.push(`📁 **[Open ${scopeLabel} Folder: ${card.folder_path}](${card.folder_web_url})**${badge}\n`);

    if (card.matched_files.length > 0) {
      lines.push("Matching media files inside:");
      for (const file of card.matched_files) {
        const icon = file.record_type === "video" ? "🎬" : "🖼️";
        const desc = file.visual_summary || file.visual_tags || (card.is_personal ? "Personal file" : "Company media asset");
        lines.push(`- ${icon} [${file.name}](${file.file_web_url}) — *${desc}*`);
      }
      lines.push("");
    } else {
      lines.push(`*(${card.is_personal ? "Personal" : "Company"} folder directory — click the link above to open and browse all files inside)*\n`);
    }
  }

  lines.push("Click any link above to open directly in OneDrive / SharePoint.");
  return lines.join("\n");
}

/**
 * Executes the RAG Generation pipeline with Multi-Provider Key Pools (Gemini + Groq)
 * and strict URL guardrails (guaranteed zero URL hallucinations).
 */
export async function generateRagAnswer(
  query: string,
  retrievedRecords: OneDriveRecord[],
  folderCards: FolderCard[]
): Promise<string> {
  // If no items matched in OneDrive, return instantly without waiting for an LLM
  if (retrievedRecords.length === 0 || folderCards.length === 0) {
    return "I couldn't find any matching folder or media in OneDrive for that query.";
  }

  const formattedRecords = formatRetrievedRecords(retrievedRecords);

  const systemInstruction = `You are the Company OneDrive Media Locator Assistant. Your job is to help employees quickly find the exact OneDrive folder or media asset they need and provide a direct clickable link to open it.

Strict Rules:
1. Answer using ONLY the records inside <retrieved_onedrive_items>.
2. NEVER invent, shorten, or modify any URL. Copy folder_web_url and file_web_url character-for-character.
3. Always group results by their Parent Folder first and format as a clickable Markdown hyperlink:
   - 📁 **[Open OneDrive Folder: {folder_path}]({folder_web_url})**
4. If a folder was retrieved (such as an employee or team folder, even if no child media files are indexed inside it), confirm that the folder exists in OneDrive and provide its link directly.
5. Beneath each folder, list any matching images/videos with direct links:
   - 🎬 [{name}]({file_web_url}) — *{brief description of why it matched}* (for videos)
   - 🖼️ [{name}]({file_web_url}) — *{brief description of why it matched}* (for photos/images)
6. If no relevant folder or file is found in <retrieved_onedrive_items>, say: "I couldn't find any matching folder or media in OneDrive for that query."`;

  const userPrompt = `<retrieved_onedrive_items>
${formattedRecords}
</retrieved_onedrive_items>

User Query: "${query}"

Provide a clean, helpful response formatted strictly according to the rules above.`;

  try {
    // Phase 1 (Gemini Key Pool) -> Phase 2 (Groq Key Pool) with automated load balancing & failover
    const llmResult = await executeWithMultiProviderFallback(systemInstruction, userPrompt, 4000);

    if (llmResult?.text && llmResult.text.trim()) {
      // Apply strict URL validation guardrail (zero hallucinated links)
      return validateAndSanitizeUrls(llmResult.text, retrievedRecords);
    }
  } catch (error) {
    console.warn("[RAG Chain] Multi-provider execution error, using deterministic fallback:", error);
  }

  // Phase 3: Instant Deterministic Answer (0ms latency, zero hallucinations, 100% verified links)
  return generateDeterministicAnswer(query, folderCards);
}
