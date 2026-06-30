"use client";

import { useRef, useState, KeyboardEvent } from "react";
import { t } from "@/lib/i18n";

interface CategoryInputProps {
  categories: string[];
  suggestions: string[];
  onChange: (categories: string[]) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function CategoryInput({
  categories,
  suggestions,
  onChange,
  disabled,
  autoFocus,
}: CategoryInputProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const addCategory = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || categories.includes(trimmed)) return;
    onChange([...categories, trimmed]);
    setInput("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && input.trim()) {
      e.preventDefault();
      addCategory(input);
    }
    if (e.key === "Backspace" && !input && categories.length > 0) {
      onChange(categories.slice(0, -1));
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">
        {t("addCategory")}
      </label>
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-gray-200 bg-white p-2 focus-within:ring-2 focus-within:ring-blue-500">
        {categories.map((cat) => (
          <span
            key={cat}
            className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-sm text-green-800"
          >
            {cat}
            {!disabled && (
              <button
                type="button"
                className="ml-0.5 text-green-600 hover:text-green-900"
                onClick={() => onChange(categories.filter((c) => c !== cat))}
                aria-label={`Rimuovi ${cat}`}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            ref={inputRef}
            type="text"
            list="category-suggestions"
            className="min-w-[120px] flex-1 border-0 bg-transparent p-1 text-sm outline-none"
            placeholder={t("categoryPlaceholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (input.trim()) addCategory(input);
            }}
            autoFocus={autoFocus}
            disabled={disabled}
          />
        )}
      </div>
      <datalist id="category-suggestions">
        {suggestions
          .filter((s) => !categories.includes(s))
          .map((s) => (
            <option key={s} value={s} />
          ))}
      </datalist>
    </div>
  );
}
