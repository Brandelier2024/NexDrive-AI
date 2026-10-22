import crypto from "crypto";

/**
 * Extracts plain text from richText arrays, richText objects, or nested segments.
 * Prevents rich-text from being coerced into "[object Object]".
 */
export function extractRichText(val) {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") return val.trim();
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (val instanceof Date) return val.toISOString().split("T")[0];

  if (Array.isArray(val)) {
    return val
      .map((segment) => {
        if (!segment) return "";
        if (typeof segment === "string") return segment;
        if (typeof segment === "object" && "text" in segment) {
          return extractRichText(segment.text);
        }
        return String(segment);
      })
      .join("")
      .trim();
  }

  if (typeof val === "object") {
    if ("richText" in val && Array.isArray(val.richText)) {
      return extractRichText(val.richText);
    }
    if ("text" in val) {
      return extractRichText(val.text);
    }
    return "";
  }

  return String(val).trim();
}

/**
 * Normalizes SharePoint and OneDrive URLs, resolving relative internal paths
 * like ../../../:f:/g/... to absolute web URLs.
 */
export function normalizeUrl(rawUrl) {
  if (!rawUrl) return "";
  const url = String(rawUrl).trim().replace(/^['"]|['"]$/g, "");
  if (!url) return "";

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  // Handle relative SharePoint paths like ../../../:f:/g/... or :f:/g/...
  const cleaned = url.replace(/^(\.\.[\/\\])+/, "/").replace(/^\/+/, "/");
  return `https://brandeliermediaworksllp-my.sharepoint.com${cleaned}`;
}

/**
 * Robust cell extraction handling raw strings, richText objects, hyperlinks, and formulas.
 */
export function extractCell(cell) {
  if (!cell) return { text: "", url: "" };
  const val = cell.value;
  if (val === null || val === undefined) return { text: "", url: "" };

  if (typeof val === "object") {
    // 1. Hyperlink object
    if ("hyperlink" in val && val.hyperlink) {
      const rawText = val.text !== undefined && val.text !== null ? extractRichText(val.text) : "";
      const url = normalizeUrl(val.hyperlink);
      return {
        text: rawText || url,
        url,
      };
    }

    // 2. Formula object
    if ("result" in val && val.result !== undefined) {
      const resText = extractRichText(val.result);
      const formStr = String(val.formula || "").trim();
      const m = formStr.match(/HYPERLINK\(\s*["']([^"']+)["']\s*(?:,\s*["']([^"']+)["'])?\s*\)/i);
      if (m) {
        return {
          text: (m[2] ? extractRichText(m[2]) : resText) || m[1].trim(),
          url: normalizeUrl(m[1]),
        };
      }
      return {
        text: resText,
        url: /^https?:\/\//i.test(resText) ? normalizeUrl(resText) : "",
      };
    }

    // 3. RichText object
    if ("richText" in val && Array.isArray(val.richText)) {
      const text = extractRichText(val.richText);
      return {
        text,
        url: /^https?:\/\//i.test(text) ? normalizeUrl(text) : "",
      };
    }

    // 4. Date object
    if (val instanceof Date) {
      return { text: val.toISOString().split("T")[0], url: "" };
    }

    // 5. Fallback for unrecognized objects (e.g. error cells, formulas without results)
    return { text: "", url: "" };
  }

  const str = String(val).trim();
  if (/^https?:\/\//i.test(str)) {
    return { text: str, url: normalizeUrl(str) };
  }

  return { text: str, url: "" };
}

/**
 * Extracts normalized text from a header cell, handling richText formatting.
 */
export function extractHeaderCell(cell) {
  return extractCell(cell).text.toLowerCase().trim();
}

/**
 * Generates a deterministic content-based ID for a master edit project row.
 */
export function generateMasterEditId(
  sheetName,
  client,
  heading,
  rawUrl,
  finalUrl,
  occurrenceIndex = 0
) {
  const safeSheetKey = sheetName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
  const rawKey = [
    sheetName.trim().toLowerCase(),
    (client || "").trim().toLowerCase(),
    (heading || "").trim().toLowerCase(),
    (rawUrl || "").trim().toLowerCase(),
    (finalUrl || "").trim().toLowerCase(),
  ].join("|");

  const hash = crypto.createHash("sha256").update(rawKey).digest("hex").slice(0, 16);
  const suffix = occurrenceIndex > 0 ? `_${occurrenceIndex}` : "";
  return `master_edit_${safeSheetKey}_${hash}${suffix}`;
}
