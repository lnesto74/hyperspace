"use client";

import { useState } from "react";
import type { Pin as PinType } from "@/lib/types";
import { CategoryInput } from "./CategoryInput";
import { collectCategories } from "@/lib/export";
import { t } from "@/lib/i18n";

interface PinEditorProps {
  pin: PinType | null;
  allPins: PinType[];
  onUpdate: (pin: PinType) => void;
  onDelete: (id: string) => void;
  readOnly?: boolean;
  autoFocus?: boolean;
}

export function PinEditor({
  pin,
  allPins,
  onUpdate,
  onDelete,
  readOnly,
  autoFocus,
}: PinEditorProps) {
  const suggestions = collectCategories(allPins);

  if (!pin) {
    return (
      <div className="p-4 text-center text-sm text-gray-400">
        {t("selectPin")}
      </div>
    );
  }

  return (
    <div className="space-y-4 border-t border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">
          #{pin.number}
        </h3>
        {!readOnly && (
          <button
            type="button"
            className="text-sm text-red-600 hover:text-red-800"
            onClick={() => {
              if (confirm(t("deleteConfirm", { number: pin.number }))) {
                onDelete(pin.id);
              }
            }}
          >
            {t("deletePin")}
          </button>
        )}
      </div>

      <CategoryInput
        categories={pin.categories}
        suggestions={suggestions}
        onChange={(categories) => onUpdate({ ...pin, categories })}
        disabled={readOnly}
        autoFocus={autoFocus}
      />

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          {t("label")}
        </label>
        <input
          type="text"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder={t("labelPlaceholder")}
          value={pin.label ?? ""}
          onChange={(e) =>
            onUpdate({ ...pin, label: e.target.value || null })
          }
          disabled={readOnly}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          {t("note")}
        </label>
        <textarea
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder={t("notePlaceholder")}
          rows={2}
          value={pin.note ?? ""}
          onChange={(e) =>
            onUpdate({ ...pin, note: e.target.value || null })
          }
          disabled={readOnly}
        />
      </div>
    </div>
  );
}

interface MobileSheetProps {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export function MobileSheet({ open, onToggle, children }: MobileSheetProps) {
  return (
    <>
      <button
        type="button"
        className="fixed bottom-4 right-4 z-40 rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg md:hidden"
        onClick={onToggle}
      >
        {open ? t("showMap") : t("showList")}
      </button>
      <div
        className={`fixed inset-x-0 bottom-0 z-30 flex max-h-[70vh] flex-col rounded-t-2xl bg-white shadow-2xl transition-transform md:hidden ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        {children}
      </div>
    </>
  );
}

export function useMobileSheet() {
  const [listOpen, setListOpen] = useState(false);
  return { listOpen, toggleList: () => setListOpen((v) => !v) };
}
