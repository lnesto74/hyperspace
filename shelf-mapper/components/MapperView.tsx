"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Pin, Project } from "@/lib/types";
import { FloorplanCanvas } from "@/components/FloorplanCanvas";
import { PinList } from "@/components/PinList";
import { PinEditor, MobileSheet, useMobileSheet } from "@/components/PinEditor";
import { HintOverlay } from "@/components/HintOverlay";
import { useAutosave, useProjectPins } from "@/lib/hooks";
import { createPin, submitProject } from "@/lib/supabase";
import { nextPinNumber, renumberPins } from "@/lib/export";
import { t } from "@/lib/i18n";

const HINT_KEY = "shelf-mapper:hint-dismissed:";

interface MapperViewProps {
  project: Project;
  shareToken: string;
  isOwner?: boolean;
}

export function MapperView({ project, shareToken, isOwner }: MapperViewProps) {
  const { pins, setPins, loading } = useProjectPins(project, shareToken);
  const readOnly = project.locked;
  const { saveStatus, queueSave, removePin } = useAutosave(
    shareToken,
    project.id,
    readOnly,
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [centerOnId, setCenterOnId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [submitted, setSubmitted] = useState(Boolean(project.submitted_at));
  const [autoFocusInput, setAutoFocusInput] = useState(false);
  const { listOpen, toggleList } = useMobileSheet();
  const searchParams = useSearchParams();
  const ownerMode = isOwner || searchParams.get("owner") === "1";

  const hintKey = `${HINT_KEY}${shareToken}`;

  useEffect(() => {
    if (typeof window !== "undefined") {
      setShowHint(!localStorage.getItem(hintKey));
    }
  }, [hintKey]);

  const dismissHint = () => {
    localStorage.setItem(hintKey, "1");
    setShowHint(false);
  };

  const selectedPin = pins.find((p) => p.id === selectedId) ?? null;

  const updatePin = useCallback(
    (updated: Pin) => {
      setPins((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      queueSave(updated);
    },
    [setPins, queueSave],
  );

  const handleAddPin = useCallback(
    (x: number, y: number) => {
      if (readOnly) return;
      const pin = createPin({
        projectId: project.id,
        number: nextPinNumber(pins),
        x,
        y,
      });
      setPins((prev) => [...prev, pin]);
      setSelectedId(pin.id);
      setAutoFocusInput(true);
      queueSave(pin);
      setTimeout(() => setAutoFocusInput(false), 100);
    },
    [readOnly, project.id, pins, setPins, queueSave],
  );

  const handleMovePin = useCallback(
    (id: string, x: number, y: number) => {
      const pin = pins.find((p) => p.id === id);
      if (!pin) return;
      const updated = { ...pin, x, y };
      setPins((prev) => prev.map((p) => (p.id === id ? updated : p)));
      queueSave(updated);
    },
    [pins, setPins, queueSave],
  );

  const handleSelectPin = useCallback((id: string) => {
    setSelectedId(id);
    setCenterOnId(id);
    setTimeout(() => setCenterOnId(null), 300);
  }, []);

  const handleDeletePin = useCallback(
    async (id: string) => {
      setPins((prev) => prev.filter((p) => p.id !== id));
      if (selectedId === id) setSelectedId(null);
      await removePin(id);
    },
    [setPins, selectedId, removePin],
  );

  const handleUndo = useCallback(() => {
    if (readOnly || pins.length === 0) return;
    const last = [...pins].sort((a, b) => b.number - a.number)[0];
    if (last) handleDeletePin(last.id);
  }, [readOnly, pins, handleDeletePin]);

  const handleRenumber = useCallback(() => {
    if (!confirm(t("renumberConfirm"))) return;
    const renumbered = renumberPins(pins);
    setPins(renumbered);
    renumbered.forEach((p) => queueSave(p));
  }, [pins, setPins, queueSave]);

  const handleSubmit = async () => {
    try {
      await submitProject(project.id, shareToken);
      setSubmitted(true);

      // Webhook via API route
      await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          projectName: project.name,
          shareToken,
          pinCount: pins.length,
        }),
      });
    } catch {
      alert(t("submitError"));
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-500">
        …
      </div>
    );
  }

  const listPanel = (
    <>
      <PinList
        pins={pins}
        selectedId={selectedId}
        search={search}
        onSearchChange={setSearch}
        onSelect={handleSelectPin}
        onDelete={handleDeletePin}
        projectName={project.name}
        readOnly={readOnly}
      />
      <PinEditor
        pin={selectedPin}
        allPins={pins}
        onUpdate={updatePin}
        onDelete={handleDeletePin}
        readOnly={readOnly}
        autoFocus={autoFocusInput}
      />
    </>
  );

  return (
    <div className="flex h-screen flex-col">
      {/* Top bar */}
      <header className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-2">
        <h1 className="truncate text-lg font-semibold">{project.name}</h1>
        <span className="text-sm text-gray-500">
          {t("shelves", { count: pins.length })}
        </span>
        <div className="flex-1" />
        {saveStatus === "saving" && (
          <span className="text-xs text-gray-400">{t("saving")}</span>
        )}
        {saveStatus === "saved" && (
          <span className="text-xs text-green-600">{t("saved")}</span>
        )}
        {readOnly && (
          <span className="text-xs text-amber-600">{t("readOnly")}</span>
        )}
        {!readOnly && (
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            onClick={handleUndo}
          >
            {t("undo")}
          </button>
        )}
        {ownerMode && !readOnly && (
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            onClick={handleRenumber}
          >
            {t("renumber")}
          </button>
        )}
        {!readOnly && !submitted && (
          <button
            type="button"
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            onClick={handleSubmit}
          >
            {t("submit")}
          </button>
        )}
      </header>

      {submitted && (
        <div className="bg-green-50 px-4 py-2 text-center text-sm text-green-800">
          <strong>{t("submittedThankYou")}</strong>{" "}
          <span className="text-green-700">{t("submittedNote")}</span>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Map */}
        <div className="relative h-full w-full md:w-[70%]">
          <FloorplanCanvas
            floorplanUrl={project.floorplan_url}
            imageW={project.image_w}
            imageH={project.image_h}
            pins={pins}
            selectedId={selectedId}
            onAddPin={handleAddPin}
            onSelectPin={handleSelectPin}
            onMovePin={handleMovePin}
            readOnly={readOnly}
            centerOnPinId={centerOnId}
          />
          {showHint && <HintOverlay onDismiss={dismissHint} />}
        </div>

        {/* Desktop list panel */}
        <aside className="hidden h-full w-[30%] flex-col border-l border-gray-200 bg-white md:flex">
          {listPanel}
        </aside>
      </div>

      {/* Mobile bottom sheet */}
      <MobileSheet open={listOpen} onToggle={toggleList}>
        {listPanel}
      </MobileSheet>
    </div>
  );
}
