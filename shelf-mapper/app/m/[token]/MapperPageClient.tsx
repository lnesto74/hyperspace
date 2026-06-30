"use client";

import { useEffect, useState } from "react";
import { getProjectByToken, seedTreviglioLocal } from "@/lib/supabase";
import type { Project } from "@/lib/types";
import { MapperView } from "@/components/MapperView";
import { t } from "@/lib/i18n";

export function MapperPageClient({ token }: { token: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    seedTreviglioLocal();
    getProjectByToken(token)
      .then((p) => {
        if (!p) setError(true);
        else setProject(p);
      })
      .catch(() => setError(true));
  }, [token]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-500">
        {t("loadError")}
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-500">
        …
      </div>
    );
  }

  return <MapperView project={project} shareToken={token} />;
}
