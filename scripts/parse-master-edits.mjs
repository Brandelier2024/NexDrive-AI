import ExcelJS from "exceljs";
import fs from "fs";

// Helper to extract clean text and URL from any cell
function extractCell(cell) {
  if (!cell) return { text: "", url: "" };
  let val = cell.value;
  if (val === null || val === undefined) return { text: "", url: "" };

  if (typeof val === "object") {
    // Hyperlink object
    if (val.hyperlink) {
      return {
        text: String(val.text || val.hyperlink).trim(),
        url: String(val.hyperlink).trim(),
      };
    }
    // Formula object
    if (val.result !== undefined) {
      const resStr = String(val.result || "").trim();
      const formStr = String(val.formula || "").trim();
      // Check if formula has HYPERLINK("url", "text")
      const m = formStr.match(/HYPERLINK\(\s*["']([^"']+)["']\s*(?:,\s*["']([^"']+)["'])?\s*\)/i);
      if (m) {
        return {
          text: (m[2] || resStr || m[1]).trim(),
          url: m[1].trim(),
        };
      }
      return { text: resStr, url: "" };
    }
    // Date object
    if (val instanceof Date) {
      return { text: val.toISOString().split("T")[0], url: "" };
    }
    if (val.richText) {
      const fullText = val.richText.map(r => r.text).join("");
      return { text: fullText.trim(), url: "" };
    }
  }

  const str = String(val).trim();
  // Check if raw text is a URL
  if (/^https?:\/\//i.test(str)) {
    return { text: str, url: str };
  }

  return { text: str, url: "" };
}

async function analyze() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile("scripts/master_edits_live.xlsx");

  const monthSheets = [
    "JULY", "AUG", "SEP 25", "Oct 25", "NOV 25", "December 25",
    "January 2026", "February 2026", "March 2026", "Apr 2026", "May 2026",
    "April 2026", "June 2026", "July 2026", "Aug 2026", "Sept 2026", "Oct 2026", "Stellarfurn"
  ];

  let totalProjects = 0;
  let totalWithRawLink = 0;
  let totalWithFinalLink = 0;
  const allProjects = [];

  for (const sheetName of monthSheets) {
    const ws = workbook.getWorksheet(sheetName);
    if (!ws) {
      console.log(`Sheet "${sheetName}" not found in workbook.`);
      continue;
    }

    // Find header row (usually row 1, but scan first 3 rows if needed)
    let headerRowIdx = 1;
    let headers = [];
    for (let r = 1; r <= 3; r++) {
      const row = ws.getRow(r);
      const rowVals = [];
      row.eachCell({ includeEmpty: true }, (c, col) => {
        rowVals[col] = String(c.value || "").trim().toLowerCase();
      });
      if (rowVals.some(v => v.includes("client") || v.includes("reel") || v.includes("heading") || v.includes("status"))) {
        headerRowIdx = r;
        headers = rowVals;
        break;
      }
    }

    let clientCol = -1;
    let headingCol = -1;
    let assignedCol = -1;
    let shootCol = -1;
    let statusCol = -1;
    let rawCol = -1;
    let finalCol = -1;
    let dateCol = -1;

    for (let c = 1; c < headers.length; c++) {
      const h = headers[c] || "";
      if (h.includes("client") || h === "brand") clientCol = c;
      else if (h.includes("reel") || h.includes("heading") || h.includes("media") || h.includes("topic") || h.includes("title")) headingCol = c;
      else if (h.includes("assigned")) assignedCol = c;
      else if (h.includes("shoot done") || h.includes("shooter") || h.includes("videographer")) shootCol = c;
      else if (h.includes("status")) statusCol = c;
      else if (h.includes("raw")) rawCol = c;
      else if (h.includes("final") || h.includes("edit link")) finalCol = c;
      else if (h.includes("shoot date") || h.includes("posting date") || h.includes("due date")) {
        if (dateCol === -1) dateCol = c;
      }
    }

    // First pass: collect known shoot names to URLs mapping in this sheet
    const shootNameToUrl = new Map();
    for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (rawCol !== -1) {
        const rawCell = extractCell(row.getCell(rawCol));
        if (rawCell.url && rawCell.text && rawCell.text !== rawCell.url) {
          shootNameToUrl.set(rawCell.text.toLowerCase().trim(), rawCell.url);
        }
      }
    }

    let sheetProjectCount = 0;
    let sheetRawLinkCount = 0;
    let sheetFinalLinkCount = 0;

    for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const client = clientCol !== -1 ? extractCell(row.getCell(clientCol)).text : "";
      const heading = headingCol !== -1 ? extractCell(row.getCell(headingCol)).text : "";
      const assignedTo = assignedCol !== -1 ? extractCell(row.getCell(assignedCol)).text : "";
      const shootDoneBy = shootCol !== -1 ? extractCell(row.getCell(shootCol)).text : "";
      const status = statusCol !== -1 ? extractCell(row.getCell(statusCol)).text : "";
      const dateVal = dateCol !== -1 ? extractCell(row.getCell(dateCol)).text : "";

      let rawData = rawCol !== -1 ? extractCell(row.getCell(rawCol)) : { text: "", url: "" };
      let finalData = finalCol !== -1 ? extractCell(row.getCell(finalCol)) : { text: "", url: "" };

      // If rawData doesn't have direct url, check shootNameToUrl map
      if (!rawData.url && rawData.text) {
        const inherited = shootNameToUrl.get(rawData.text.toLowerCase().trim());
        if (inherited) {
          rawData.url = inherited;
        }
      }

      // If client and heading are both empty, skip empty row or summary row
      if (!client && !heading) continue;
      if (client.toLowerCase() === "grand total" || client.toLowerCase() === "count of status") continue;

      sheetProjectCount++;
      if (rawData.url) sheetRawLinkCount++;
      if (finalData.url) sheetFinalLinkCount++;

      allProjects.push({
        sheet: sheetName,
        rowNumber: r,
        client,
        heading,
        assignedTo,
        shootDoneBy,
        status,
        date: dateVal,
        rawLinkText: rawData.text,
        rawLinkUrl: rawData.url,
        finalLinkText: finalData.text,
        finalLinkUrl: finalData.url,
      });
    }

    totalProjects += sheetProjectCount;
    totalWithRawLink += sheetRawLinkCount;
    totalWithFinalLink += sheetFinalLinkCount;

    console.log(`Sheet "${sheetName}": ${sheetProjectCount} projects | ${sheetRawLinkCount} raw links | ${sheetFinalLinkCount} final links`);
  }

  console.log("\n=======================================================");
  console.log(`TOTAL PROJECTS: ${totalProjects}`);
  console.log(`TOTAL WITH RAW DATA LINK: ${totalWithRawLink}`);
  console.log(`TOTAL WITH FINAL EDIT LINK: ${totalWithFinalLink}`);
  console.log("=======================================================");

  fs.writeFileSync("scripts/parsed_master_edits.json", JSON.stringify(allProjects, null, 2));
  console.log("Saved all projects to scripts/parsed_master_edits.json");
}

analyze().catch(console.error);
