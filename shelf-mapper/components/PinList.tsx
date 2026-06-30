"use client";

import { useEffect, useRef } from "react";
import type { Pin } from "@/lib/types";
import { t } from "@/lib/i18n";
import {
  exportToCsv,
  exportToJson,
  exportToXlsx,
  pinsToExportRows,
  downloadBlob,
} from "@/lib/export";

interface PinListProps {
  pins: Pin[];
  selectedId: string | null;
  search: string;
  onSearchChange: (q: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  projectName: string;
  readOnly?: boolean;
}

export function PinList({
  pins,
  selectedId,
  search,
  onSearchChange,
  onSelect,
  onDelete,
  projectName,
  readOnly,
}: PinListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  const filtered = pins.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      String(p.number).includes(q) ||
      p.categories.some((c) => c.toLowerCase().includes(q)) ||
      (p.label?.toLowerCase().includes(q) ?? false)
    );
  });

  const sorted = [...filtered].sort((a, b) => a.number - b.number);

  useEffect(() => {
    if (selectedId && selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedId]);

  const handleExport = async (format: "xlsx" | "csv" | "json") => {
    const rows = pinsToExportRows(pins);
    const base = projectName.replace(/\s+/g, "_").toLowerCase();
    if (format === "xlsx") {
      await exportToXlsx(rows, `${base}_scaffali.xlsx`);
    } else if (format === "csv") {
      downloadBlob(exportToCsv(rows), `${base}_scaffali.csv`, "text/csv");
    } else {
      downloadBlob(exportToJson(rows), `${base}_scaffali.json`, "application/json");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-200 p-3">
        <div className="mb-2 text-sm font-semibold text-gray-700">
          {t("shelves", { count: pins.length })}
        </div>
        <input
          type="search"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder={t("search")}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <p className="p-4 text-center text-sm text-gray-400">{t("noPins")}</p>
        ) : (
          sorted.map((pin) => {
            const assigned = pin.categories.length > 0;
            const isSelected = pin.id === selectedId;
            return (
              <div
                key={pin.id}
                className={`flex min-h-[52px] items-center gap-2 border-b border-gray-100 px-3 py-3 active:bg-gray-50 ${
                  isSelected ? "bg-blue-50" : ""
                } ${!assigned ? "border-l-4 border-l-amber-400" : ""}`}
              >
                <button
                  ref={isSelected ? selectedRef : undefined}
                  type="button"
                  className="flex min-h-[44px] flex-1 items-start gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  onClick={() => onSelect(pin.id)}
                >
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      assigned
                        ? "bg-pin-assigned text-white"
                        : "border-2 border-pin-unassigned text-amber-700"
                    }`}
                  >
                    {pin.number}
                  </span>
                  <div className="min-w-0 flex-1">
                    {assigned ? (
                      <div className="flex flex-wrap gap-1">
                        {pin.categories.map((c) => (
                          <span
                            key={c}
                            className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs italic text-amber-600">
                        {t("unassigned")}
                      </span>
                    )}
                    {pin.label && (
                      <div className="mt-0.5 truncate text-xs text-gray-500">
                        {pin.label}
                      </div>
                    )}
                  </div>
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-gray-400 active:bg-red-50 active:text-red-600"
                    onClick={() => {
                      if (confirm(t("deleteConfirm", { number: pin.number }))) {
                        onDelete(pin.id);
                      }
                    }}
                    aria-label={t("deletePin")}
                  >
                    🗑
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-gray-200 p-3">
        <p className="mb-2 text-xs font-medium text-gray-500">{t("export")}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="min-h-[44px] rounded-lg bg-gray-100 px-3 py-2 text-xs font-medium active:bg-gray-200"
            onClick={() => handleExport("xlsx")}
          >
            {t("exportXlsx")}
          </button>
          <button
            type="button"
            className="min-h-[44px] rounded-lg bg-gray-100 px-3 py-2 text-xs font-medium active:bg-gray-200"
            onClick={() => handleExport("csv")}
          >
            {t("exportCsv")}
          </button>
          <button
            type="button"
            className="min-h-[44px] rounded-lg bg-gray-100 px-3 py-2 text-xs font-medium active:bg-gray-200"
            onClick={() => handleExport("json")}
          >
            {t("exportJson")}
          </button>
        </div>
      </div>
    </div>
  );
}
