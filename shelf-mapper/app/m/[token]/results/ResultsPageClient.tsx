"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getProjectByToken, getPins, seedTreviglioLocal } from "@/lib/supabase";
import type { Pin, Project } from "@/lib/types";
import { t } from "@/lib/i18n";
import {
  exportToCsv,
  exportToJson,
  exportToXlsx,
  pinsToExportRows,
  downloadBlob,
} from "@/lib/export";

export function ResultsPageClient({ token }: { token: string }) {
  const searchParams = useSearchParams();
  const secret = searchParams.get("secret") ?? "";
  const [project, setProject] = useState<Project | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    seedTreviglioLocal();
    getProjectByToken(token).then(async (p) => {
      if (!p) {
        setAuthorized(false);
        return;
      }
      const globalSecret = process.env.NEXT_PUBLIC_RESULTS_SECRET;
      const ok =
        p.owner_secret === secret ||
        Boolean(globalSecret && globalSecret === secret);
      setAuthorized(ok);
      if (ok) {
        setProject(p);
        const pinList = await getPins(p.id, token);
        setPins(pinList);
      }
    });
  }, [token, secret]);

  if (authorized === null) {
    return <div className="p-8 text-center text-gray-500">…</div>;
  }

  if (!authorized) {
    return (
      <div className="p-8 text-center text-red-600">
        {t("resultsUnauthorized")}
      </div>
    );
  }

  const rows = pinsToExportRows(pins);

  const handleExport = async (format: "xlsx" | "csv" | "json") => {
    const base = (project?.name ?? "progetto").replace(/\s+/g, "_").toLowerCase();
    if (format === "xlsx") {
      await exportToXlsx(rows, `${base}_scaffali.xlsx`);
    } else if (format === "csv") {
      downloadBlob(exportToCsv(rows), `${base}_scaffali.csv`, "text/csv");
    } else {
      downloadBlob(exportToJson(rows), `${base}_scaffali.json`, "application/json");
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-3 py-4 pb-safe sm:px-4 sm:py-8">
      <header className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:flex-wrap sm:items-center">
        <h1 className="text-2xl font-bold">
          {t("resultsTitle")}: {project?.name}
        </h1>
        <a
          href={`/m/${token}?owner=1`}
          className="text-sm text-blue-600 hover:underline"
        >
          {t("backToMapper")}
        </a>
        <div className="flex-1" />
        <button
          type="button"
          className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm hover:bg-gray-200"
          onClick={() => handleExport("xlsx")}
        >
          {t("exportXlsx")}
        </button>
        <button
          type="button"
          className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm hover:bg-gray-200"
          onClick={() => handleExport("csv")}
        >
          {t("exportCsv")}
        </button>
        <button
          type="button"
          className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm hover:bg-gray-200"
          onClick={() => handleExport("json")}
        >
          {t("exportJson")}
        </button>
      </header>

      {pins.length === 0 ? (
        <p className="text-gray-500">{t("noPins")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 font-medium">{t("tableNumber")}</th>
                <th className="px-4 py-3 font-medium">{t("tableLabel")}</th>
                <th className="px-4 py-3 font-medium">{t("tableCategories")}</th>
                <th className="px-4 py-3 font-medium">{t("tableNote")}</th>
                <th className="px-4 py-3 font-medium">{t("tableX")}</th>
                <th className="px-4 py-3 font-medium">{t("tableY")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.number} className="border-b border-gray-100">
                  <td className="px-4 py-2 font-mono">{r.number}</td>
                  <td className="px-4 py-2">{r.label}</td>
                  <td className="px-4 py-2">{r.categories}</td>
                  <td className="px-4 py-2">{r.note}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.x}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.y}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
