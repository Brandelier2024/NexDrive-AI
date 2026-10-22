import type ExcelJS from "exceljs";

export function extractRichText(val: unknown): string;

export function normalizeUrl(rawUrl: unknown): string;

export function extractCell(cell: ExcelJS.Cell | null | undefined): { text: string; url: string };

export function extractHeaderCell(cell: ExcelJS.Cell | null | undefined): string;

export function generateMasterEditId(
  sheetName: string,
  client: string,
  heading: string,
  rawUrl: string,
  finalUrl: string,
  occurrenceIndex?: number
): string;
