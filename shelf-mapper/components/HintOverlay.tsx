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
      <div className="mx-4 max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl">
        <p className="mb-2 text-lg font-medium text-gray-900">{t("hint1")}</p>
        <p className="mb-2 text-lg font-medium text-gray-900">{t("hint2")}</p>
        <p className="mb-6 text-lg font-medium text-gray-900">{t("hint3")}</p>
        <span className="text-sm text-gray-500">{t("hintDismiss")}</span>
      </div>
    </button>
  );
}
