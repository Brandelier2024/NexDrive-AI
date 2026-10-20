import { GoogleGenAI } from "@google/genai";
import { config } from "@/lib/config";

export interface VisionDescriptionResult {
  summary: string;
  tags: string;
}

/**
 * Checks if Gemini API is configured with a valid key
 */
export function isGeminiConfigured(): boolean {
  return (
    Boolean(config.gemini.apiKey) &&
    !config.gemini.apiKey.includes("your_")
  );
}

/**
 * Fetches lightweight thumbnail URL for an image or video from Microsoft Graph API.
 * Never downloads the full video file!
 */
export async function fetchItemThumbnailUrl(
  accessToken: string,
  driveId: string,
  itemId: string
): Promise<string | null> {
  try {
    const url = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/thumbnails/0/large`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as { url?: string };
    return data.url ?? null;
  } catch (error) {
    console.warn(`[Thumbnail] Failed to fetch thumbnail for item ${itemId}:`, error);
    return null;
  }
}

/**
 * Uses Gemini (e.g. gemini-2.5-flash) to generate a 1-sentence visual summary
 * and keyword tags from an image/video thumbnail.
 * If Gemini or vision captioning is disabled, falls back to path/name extraction.
 */
export async function describeThumbnail(
  thumbnailUrl: string | null,
  fileName: string,
  folderPath: string
): Promise<VisionDescriptionResult> {
  // If vision captioning is disabled or Gemini key not set, or no thumbnail URL:
  if (!config.gemini.enableVisionCaptioning || !isGeminiConfigured() || !thumbnailUrl) {
    return generateFallbackMetadata(fileName, folderPath);
  }

  try {
    // 1. Fetch thumbnail image bytes
    const imgRes = await fetch(thumbnailUrl);
    if (!imgRes.ok) {
      return generateFallbackMetadata(fileName, folderPath);
    }

    const arrayBuffer = await imgRes.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = imgRes.headers.get("content-type") || "image/jpeg";

    // 2. Call Gemini
    const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    const response = await ai.models.generateContent({
      model: config.gemini.visionModel || "gemini-3.8-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
            {
              text: `Analyze this image/video preview from company file "${fileName}" in folder "${folderPath}".
Provide a concise 1-sentence visual summary of what is seen, followed by 5 to 10 comma-separated keywords/tags.
Respond strictly in JSON format without markdown code blocks:
{"summary": "1-sentence summary", "tags": "tag1, tag2, tag3"}`,
            },
          ],
        },
      ],
    });

    const responseText = response.text || "";
    const cleanJson = responseText.replace(/```json\n?|```/g, "").trim();
    const parsed = JSON.parse(cleanJson) as { summary?: string; tags?: string };

    return {
      summary: parsed.summary || `Visual media for ${fileName}`,
      tags: parsed.tags || generateTagsFromNames(fileName, folderPath),
    };
  } catch (error) {
    console.warn(`[VisionDescriber] Vision analysis failed for ${fileName}, using fallback:`, error);
    return generateFallbackMetadata(fileName, folderPath);
  }
}

/**
 * Generates natural tags and summary from file and folder name keywords
 */
export function generateFallbackMetadata(
  fileName: string,
  folderPath: string
): VisionDescriptionResult {
  const tags = generateTagsFromNames(fileName, folderPath);
  const cleanName = fileName.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
  return {
    summary: `Media asset "${cleanName}" located in ${folderPath}`,
    tags,
  };
}

export function generateTagsFromNames(fileName: string, folderPath: string): string {
  const combined = `${folderPath} ${fileName}`
    .toLowerCase()
    .replace(/\.[^/.]+$/, "") // strip extension
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const words = combined.split(/\s+/).filter((w) => w.length > 2);
  const unique = Array.from(new Set(words));
  return unique.slice(0, 10).join(", ");
}
