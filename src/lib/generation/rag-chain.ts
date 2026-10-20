import { GoogleGenAI } from "@google/genai";
import { config } from "@/lib/config";
import { isGeminiConfigured } from "@/lib/crawler/vision-describer";
import { FolderCard, OneDriveRecord } from "@/lib/types";

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
    lines.push(`📁 **[Open OneDrive Folder: ${card.folder_path}](${card.folder_web_url})**\n`);

    if (card.matched_files.length > 0) {
      lines.push("Matching media files inside:");
      for (const file of card.matched_files) {
        const icon = file.record_type === "video" ? "🎬" : "🖼️";
        const desc = file.visual_summary || file.visual_tags || "Company media asset";
        lines.push(`- ${icon} [${file.name}](${file.file_web_url}) — *${desc}*`);
      }
      lines.push("");
    }
  }

  lines.push("Click any link above to open directly in OneDrive / SharePoint.");
  return lines.join("\n");
}

/**
 * Executes the RAG Generation pipeline with Gemini 2.5 Flash and strict URL guardrails
 */
export async function generateRagAnswer(
  query: string,
  retrievedRecords: OneDriveRecord[],
  folderCards: FolderCard[]
): Promise<string> {
  if (retrievedRecords.length === 0) {
    return "I couldn't find any matching folder or media in OneDrive for that query.";
  }

  if (!isGeminiConfigured()) {
    return generateDeterministicAnswer(query, folderCards);
  }

  try {
    const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    const formattedRecords = formatRetrievedRecords(retrievedRecords);

    const systemInstruction = `You are the Company OneDrive Media Locator Assistant. Your job is to help employees quickly find the exact OneDrive folder or media asset they need and provide a direct clickable link to open it.

Strict Rules:
1. Answer using ONLY the records inside <retrieved_onedrive_items>.
2. NEVER invent, shorten, or modify any URL. Copy folder_web_url and file_web_url character-for-character.
3. Always group results by their Parent Folder first and format as a clickable Markdown hyperlink:
   - 📁 **[Open OneDrive Folder: {folder_path}]({folder_web_url})**
4. Beneath each folder, list the top matching images/videos with direct links:
   - 🎬 [{name}]({file_web_url}) — *{brief description of why it matched}* (for videos)
   - 🖼️ [{name}]({file_web_url}) — *{brief description of why it matched}* (for photos/images)
5. If no relevant folder or file is found in <retrieved_onedrive_items>, say: "I couldn't find any matching folder or media in OneDrive for that query."`;

    const userPrompt = `<retrieved_onedrive_items>
${formattedRecords}
</retrieved_onedrive_items>

User Query: "${query}"

Provide a clean, helpful response formatted strictly according to the rules above.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: [
        {
          role: "user",
          parts: [{ text: `${systemInstruction}\n\n${userPrompt}` }],
        },
      ],
      config: {
        temperature: 0.0, // Strict zero hallucination setting
      },
    });

    const rawText = response.text || "";

    // Apply strict URL validation guardrail
    const sanitizedText = validateAndSanitizeUrls(rawText, retrievedRecords);
    return sanitizedText;
  } catch (error) {
    console.warn("[RAG] Gemini generation failed, falling back to deterministic answer:", error);
    return generateDeterministicAnswer(query, folderCards);
  }
}
