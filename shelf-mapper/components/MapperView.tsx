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
import { useIsMobile } from "@/lib/useMedia";

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
  const { listOpen, openList, closeList } = useMobileSheet();
  const isMobile = useIsMobile();
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
      if (isMobile) openList();
    },
    [readOnly, project.id, pins, setPins, queueSave, isMobile, openList],
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

  const handleSelectPin = useCallback(
    (id: string) => {
      setSelectedId(id);
      setCenterOnId(id);
      setTimeout(() => setCenterOnId(null), 300);
      if (isMobile) openList();
    },
    [isMobile, openList],
  );

  const handleDeletePin = useCallback(
    async (id: string) => {
      setPins((prev) => prev.filter((p) => p.id !== id));
      if (selectedId === id) setSelectedId(null);
      await removePin(id);
    },
    [setPins, selectedId, removePin],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (readOnly) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        if (selectedId) {
          e.preventDefault();
          const pin = pins.find((p) => p.id === selectedId);
          if (pin && confirm(t("deleteConfirm", { number: pin.number }))) {
            handleDeletePin(selectedId);
          }
        }
      }
      if (e.key === "Escape") {
        setSelectedId(null);
        closeList();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readOnly, selectedId, pins, handleDeletePin, closeList]);

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
      <div className="flex h-screen-safe items-center justify-center text-gray-500">
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
    <div className="flex h-screen-safe flex-col pt-safe">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-3 py-2 md:gap-3 md:px-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold md:text-lg">{project.name}</h1>
          <p className="text-xs text-gray-500 md:text-sm">
            {t("shelves", { count: pins.length })}
          </p>
        </div>

        {saveStatus === "saving" && (
          <span className="text-xs text-gray-400">{t("saving")}</span>
        )}
        {saveStatus === "saved" && (
          <span className="text-xs text-green-600">{t("saved")}</span>
        )}

        <div className="flex items-center gap-1 md:gap-2">
          {readOnly && (
            <span className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-700">
              {t("readOnly")}
            </span>
          )}
          {!readOnly && (
            <button
              type="button"
              className="min-h-[44px] rounded-lg px-3 py-2 text-sm text-gray-600 active:bg-gray-100"
              onClick={handleUndo}
            >
              {t("undo")}
            </button>
          )}
          {ownerMode && !readOnly && (
            <button
              type="button"
              className="hidden min-h-[44px] rounded-lg px-3 py-2 text-sm text-gray-600 active:bg-gray-100 sm:inline"
              onClick={handleRenumber}
            >
              {t("renumber")}
            </button>
          )}
          {!readOnly && !submitted && (
            <button
              type="button"
              className="min-h-[44px] rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white active:bg-blue-700"
              onClick={handleSubmit}
            >
              {t("submit")}
            </button>
          )}
        </div>
      </header>

      {submitted && (
        <div className="shrink-0 bg-green-50 px-3 py-2 text-center text-xs text-green-800 md:text-sm">
          <strong>{t("submittedThankYou")}</strong>{" "}
          <span className="text-green-700">{t("submittedNote")}</span>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
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

        <aside className="hidden h-full w-[30%] flex-col border-l border-gray-200 bg-white md:flex">
          {listPanel}
        </aside>
      </div>

      <MobileSheet
        open={listOpen}
        onOpen={openList}
        onClose={closeList}
        peek={pins.length > 0}
      >
        {listPanel}
      </MobileSheet>
    </div>
  );
}
