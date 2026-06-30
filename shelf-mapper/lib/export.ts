import type { Pin, ExportRow } from "./types";

export function pinsToExportRows(pins: Pin[]): ExportRow[] {
  return [...pins]
    .sort((a, b) => a.number - b.number)
    .map((p) => ({
      number: p.number,
      label: p.label ?? "",
      categories: p.categories.join("; "),
      note: p.note ?? "",
      x: round4(p.x),
      y: round4(p.y),
    }));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function exportToCsv(rows: ExportRow[]): string {
  const headers = ["number", "label", "categories", "note", "x", "y"];
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        r.number,
        csvEscape(r.label),
        csvEscape(r.categories),
        csvEscape(r.note),
        r.x,
        r.y,
      ].join(","),
    ),
  ];
  return lines.join("\n");
}

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportToJson(rows: ExportRow[]): string {
  return JSON.stringify(rows, null, 2);
}

export async function exportToXlsx(rows: ExportRow[], filename: string): Promise<void> {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Scaffali");
  XLSX.writeFile(wb, filename);
}

export function downloadBlob(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function collectCategories(pins: Pin[]): string[] {
  const set = new Set<string>();
  for (const pin of pins) {
    for (const cat of pin.categories) {
      if (cat.trim()) set.add(cat.trim());
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, "it"));
}

export function nextPinNumber(pins: Pin[]): number {
  if (pins.length === 0) return 1;
  return Math.max(...pins.map((p) => p.number)) + 1;
}

export function renumberPins(pins: Pin[]): Pin[] {
  const sorted = [...pins].sort((a, b) => a.number - b.number);
  return sorted.map((p, i) => ({ ...p, number: i + 1 }));
}
