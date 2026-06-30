"use client";

import { t } from "@/lib/i18n";

interface HintOverlayProps {
  onDismiss: () => void;
}

export function HintOverlay({ onDismiss }: HintOverlayProps) {
  return (
    <button
      type="button"
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onDismiss}
      aria-label={t("hintDismiss")}
    >
      <div className="mx-3 max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl sm:mx-4 sm:p-8">
        <p className="mb-2 text-base font-medium text-gray-900 sm:text-lg">{t("hint1")}</p>
        <p className="mb-2 text-base font-medium text-gray-900 sm:text-lg">{t("hint2")}</p>
        <p className="mb-4 text-base font-medium text-gray-900 sm:mb-6 sm:text-lg">{t("hint3")}</p>
        <span className="inline-block min-h-[44px] rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white">
          {t("hintDismiss")}
        </span>
      </div>
    </button>
  );
}
