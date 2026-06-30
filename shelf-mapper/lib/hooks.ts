"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Pin, Project } from "./types";
import { deletePin, getPins, savePin } from "./supabase";
import { debounce } from "./utils";

export type SaveStatus = "idle" | "saving" | "saved";

export function useAutosave(
  shareToken: string,
  projectId: string,
  readOnly: boolean,
) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const pendingRef = useRef<Map<string, Pin>>(new Map());

  const flush = useCallback(async () => {
    const pending = [...pendingRef.current.values()];
    pendingRef.current.clear();
    if (pending.length === 0) return;

    setSaveStatus("saving");
    try {
      await Promise.all(pending.map((p) => savePin(p, shareToken)));
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("idle");
    }
  }, [shareToken]);

  const debouncedFlush = useMemo(() => debounce(flush, 500), [flush]);

  const queueSave = useCallback(
    (pin: Pin) => {
      if (readOnly) return;
      pendingRef.current.set(pin.id, pin);
      debouncedFlush();
    },
    [readOnly, debouncedFlush],
  );

  const removePin = useCallback(
    async (pinId: string) => {
      if (readOnly) return;
      pendingRef.current.delete(pinId);
      setSaveStatus("saving");
      try {
        await deletePin(pinId, projectId, shareToken);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        setSaveStatus("idle");
      }
    },
    [projectId, shareToken, readOnly],
  );

  return { saveStatus, queueSave, removePin, flush };
}

export function useProjectPins(project: Project | null, shareToken: string) {
  const [pins, setPins] = useState<Pin[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!project) {
      setPins([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    getPins(project.id, shareToken)
      .then(setPins)
      .finally(() => setLoading(false));
  }, [project, shareToken]);

  return { pins, setPins, loading };
}
