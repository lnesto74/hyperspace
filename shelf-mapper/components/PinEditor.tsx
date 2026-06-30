"use client";

import { useCallback, useState } from "react";
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
        <h3 className="text-lg font-semibold text-gray-900">#{pin.number}</h3>
        {!readOnly && (
          <button
            type="button"
            className="min-h-[44px] rounded-lg px-3 text-sm text-red-600 active:bg-red-50"
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
          className="w-full rounded-lg border border-gray-200 px-3 py-3 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 md:py-2 md:text-sm"
          placeholder={t("labelPlaceholder")}
          value={pin.label ?? ""}
          onChange={(e) => onUpdate({ ...pin, label: e.target.value || null })}
          disabled={readOnly}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          {t("note")}
        </label>
        <textarea
          className="w-full rounded-lg border border-gray-200 px-3 py-3 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 md:py-2 md:text-sm"
          placeholder={t("notePlaceholder")}
          rows={2}
          value={pin.note ?? ""}
          onChange={(e) => onUpdate({ ...pin, note: e.target.value || null })}
          disabled={readOnly}
        />
      </div>
    </div>
  );
}

interface MobileSheetProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  children: React.ReactNode;
  peek?: boolean;
}

export function MobileSheet({
  open,
  onOpen,
  onClose,
  children,
  peek,
}: MobileSheetProps) {
  return (
    <>
      <button
        type="button"
        className="fixed bottom-4 right-4 z-40 flex min-h-[48px] min-w-[48px] items-center justify-center rounded-full bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg active:bg-blue-700 md:hidden"
        style={{ marginBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        onClick={open ? onClose : onOpen}
        aria-expanded={open}
      >
        {open ? t("showMap") : t("showList")}
      </button>

      {!open && peek && (
        <button
          type="button"
          className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-center border-t border-gray-200 bg-white/95 py-3 text-sm font-medium text-blue-600 backdrop-blur md:hidden"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          onClick={onOpen}
        >
          ↑ {t("showList")}
        </button>
      )}

      {open && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={onClose}
          aria-label={t("showMap")}
        />
      )}

      <div
        className={`fixed inset-x-0 bottom-0 z-40 flex max-h-[85dvh] flex-col rounded-t-2xl bg-white shadow-2xl transition-transform duration-300 ease-out md:hidden ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex shrink-0 flex-col items-center border-b border-gray-100 py-2">
          <div className="mb-1 h-1 w-10 rounded-full bg-gray-300" aria-hidden />
          <button
            type="button"
            className="min-h-[44px] px-4 text-xs font-medium text-gray-500"
            onClick={onClose}
          >
            {t("showMap")}
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </div>
    </>
  );
}

export function useMobileSheet() {
  const [listOpen, setListOpen] = useState(false);
  const openList = useCallback(() => setListOpen(true), []);
  const closeList = useCallback(() => setListOpen(false), []);
  const toggleList = useCallback(() => setListOpen((v) => !v), []);
  return { listOpen, openList, closeList, toggleList };
}
