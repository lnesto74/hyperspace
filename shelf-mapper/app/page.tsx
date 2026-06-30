"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listProjects,
  createProject,
  uploadFloorplan,
  seedTreviglioLocal,
} from "@/lib/supabase";
import type { ProjectWithPinCount } from "@/lib/types";
import { getShareUrl, getResultsUrl } from "@/lib/utils";
import { t } from "@/lib/i18n";

const TREVIGLIO_URL = "/floorplans/treviglio.png";
const TREVIGLIO_W = 2600;
const TREVIGLIO_H = 4188;

export default function DashboardPage() {
  const [projects, setProjects] = useState<ProjectWithPinCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [useTreviglio, setUseTreviglio] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      seedTreviglioLocal();
      const list = await listProjects();
      setProjects(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      let floorplanUrl = TREVIGLIO_URL;
      let imageW = TREVIGLIO_W;
      let imageH = TREVIGLIO_H;

      if (!useTreviglio && file) {
        const uploaded = await uploadFloorplan(file);
        floorplanUrl = uploaded.url;
        imageW = uploaded.width;
        imageH = uploaded.height;
      }

      await createProject({
        name: name.trim(),
        floorplanUrl,
        imageW,
        imageH,
      });

      setName("");
      setFile(null);
      setShowForm(false);
      await load();
    } catch {
      alert(t("createError"));
    } finally {
      setCreating(false);
    }
  };

  const copyLink = (token: string) => {
    const url = getShareUrl(token);
    navigator.clipboard.writeText(url);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="mx-auto max-w-3xl px-3 py-6 pb-safe sm:px-4 sm:py-8">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t("appTitle")}</h1>
        <button
          type="button"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          onClick={() => setShowForm((v) => !v)}
        >
          {t("newProject")}
        </button>
      </header>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          <h2 className="mb-4 text-lg font-semibold">{t("newProject")}</h2>
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t("projectName")}
            </label>
            <input
              type="text"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-gray-700">
              {t("chooseFloorplan")}
            </label>
            <label className="mb-2 flex items-center gap-2">
              <input
                type="radio"
                checked={useTreviglio}
                onChange={() => setUseTreviglio(true)}
              />
              <span className="text-sm">{t("useTreviglio")}</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={!useTreviglio}
                onChange={() => setUseTreviglio(false)}
              />
              <span className="text-sm">{t("uploadFloorplan")}</span>
            </label>
            {!useTreviglio && (
              <input
                type="file"
                accept="image/*"
                className="mt-2 text-sm"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required={!useTreviglio}
              />
            )}
          </div>
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {t("createProject")}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-gray-500">…</p>
      ) : projects.length === 0 ? (
        <p className="text-gray-500">{t("noProjects")}</p>
      ) : (
        <div className="space-y-3">
          {projects.map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-gray-900">{p.name}</h3>
                <p className="text-sm text-gray-500">
                  {t("pinCount", { count: p.pin_count })} ·{" "}
                  {p.submitted_at ? t("submitted") : t("draft")}
                  {p.locked ? ` · ${t("locked")}` : ""}
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium hover:bg-gray-200"
                onClick={() => copyLink(p.share_token)}
              >
                {copied === p.share_token ? t("linkCopied") : t("copyShareLink")}
              </button>
              <a
                href={getShareUrl(p.share_token)}
                className="rounded-lg bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
              >
                Apri mappa
              </a>
              <a
                href={getResultsUrl(p.share_token, p.owner_secret)}
                className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium hover:bg-gray-200"
              >
                {t("viewResults")}
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
