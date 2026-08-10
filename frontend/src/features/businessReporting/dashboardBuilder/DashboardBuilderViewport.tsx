import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import {
  LayoutDashboard,
  Plus,
  Save,
  Trash2,
  GripVertical,
  Eye,
  Pencil,
  Link2,
  Copy,
  Check,
  X,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { API_BASE } from '../../../config/api';
import { ALL_WIDGETS, getWidget } from './registry';
import { DASHBOARD_TEMPLATES, cloneTemplate } from './templates';
import {
  deleteLayout,
  getActiveLayout,
  listLayouts,
  saveLayout,
  setActiveLayoutId,
} from './storage';
import WidgetRenderer, { type DashboardDataContext } from './WidgetRenderer';
import type { DashboardItem, DashboardLayout, WidgetId, WidgetKind } from './types';
import { MAX_MAP_TILES } from './types';

const KIND_FILTERS: Array<WidgetKind | 'all'> = ['all', 'kpi', 'chart', 'map', 'table', 'insight'];

const SIZE_PRESETS: Array<{ label: string; colSpan: DashboardItem['colSpan']; rowSpan: DashboardItem['rowSpan'] }> = [
  { label: 'Full width', colSpan: 12, rowSpan: 1 },
  { label: 'Half', colSpan: 6, rowSpan: 2 },
  { label: 'Third', colSpan: 4, rowSpan: 1 },
  { label: 'Wide map', colSpan: 12, rowSpan: 3 },
  { label: 'Half tall', colSpan: 6, rowSpan: 3 },
];

function rowHeightPx(span: number) {
  return span * 140;
}

export default function DashboardBuilderViewport({
  data,
  readOnly = false,
  fixedLayout = null,
}: {
  data: DashboardDataContext;
  /** Public share — canvas only, no library / inspector / edit chrome. */
  readOnly?: boolean;
  /** Published layout snapshot (overrides localStorage). */
  fixedLayout?: DashboardLayout | null;
}) {
  const { token: authToken, isSuperadmin } = useAuth();
  const [layout, setLayout] = useState<DashboardLayout | null>(
    () => fixedLayout ?? (readOnly ? null : getActiveLayout()),
  );
  const [editing, setEditing] = useState(!readOnly);
  const [kindFilter, setKindFilter] = useState<WidgetKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishLabel, setPublishLabel] = useState('');
  const [publishExpires, setPublishExpires] = useState('30');
  const [publishing, setPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [inspectorAlign, setInspectorAlign] = useState(0);
  const builderGridRef = useRef<HTMLDivElement | null>(null);
  const tileRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const saved = readOnly ? [] : listLayouts();

  useEffect(() => {
    if (fixedLayout) setLayout(fixedLayout);
  }, [fixedLayout]);

  const library = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ALL_WIDGETS.filter((w) => {
      if (kindFilter !== 'all' && w.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        w.name.toLowerCase().includes(q)
        || w.description.toLowerCase().includes(q)
        || w.sources.some((s) => s.toLowerCase().includes(q))
      );
    });
  }, [kindFilter, query]);

  const usedOnBoard = useMemo(() => {
    const counts = new Map<WidgetId, number>();
    for (const item of layout?.items || []) {
      counts.set(item.widgetId, (counts.get(item.widgetId) || 0) + 1);
    }
    return counts;
  }, [layout?.items]);

  const selected = layout?.items.find((i) => i.instanceId === selectedId) ?? null;
  const mapCount = layout?.items.filter((i) => getWidget(i.widgetId).isMap).length ?? 0;
  const canEdit = !readOnly && editing;

  // Keep the inspector next to the selected tile so you don't scroll up to edit it.
  useLayoutEffect(() => {
    if (!canEdit || !selectedId) {
      setInspectorAlign(0);
      return;
    }
    const tile = tileRefs.current.get(selectedId);
    const grid = builderGridRef.current;
    if (!tile || !grid) {
      setInspectorAlign(0);
      return;
    }
    const align = () => {
      const gridRect = grid.getBoundingClientRect();
      const tileRect = tile.getBoundingClientRect();
      setInspectorAlign(Math.max(0, Math.round(tileRect.top - gridRect.top)));
    };
    align();
    tile.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    window.addEventListener('resize', align);
    return () => window.removeEventListener('resize', align);
  }, [canEdit, selectedId, layout?.items]);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2200);
  };

  const ensureLayout = (): DashboardLayout => {
    if (layout) return layout;
    const blank = cloneTemplate('tpl-blank')!;
    setLayout(blank);
    return blank;
  };

  const commit = (next: DashboardLayout, persist = false) => {
    if (readOnly) return;
    setLayout(next);
    if (persist) {
      saveLayout(next);
      flash('Dashboard saved');
    }
  };

  const addWidget = (widgetId: WidgetId) => {
    if (readOnly) return;
    const def = getWidget(widgetId);
    if (def.isMap && mapCount >= MAX_MAP_TILES) {
      flash(`At most ${MAX_MAP_TILES} map tiles per dashboard`);
      return;
    }
    const base = ensureLayout();
    const item: DashboardItem = {
      instanceId: `${widgetId}-${Math.random().toString(36).slice(2, 8)}`,
      widgetId,
      colSpan: def.defaultSize.colSpan,
      rowSpan: def.defaultSize.rowSpan,
    };
    const next = { ...base, items: [...base.items, item] };
    commit(next);
    setSelectedId(item.instanceId);
  };

  const removeSelected = () => {
    if (!layout || !selectedId || readOnly) return;
    commit({ ...layout, items: layout.items.filter((i) => i.instanceId !== selectedId) });
    setSelectedId(null);
  };

  const applyTemplate = (templateId: string) => {
    if (readOnly) return;
    const next = cloneTemplate(templateId);
    if (!next) return;
    commit(next);
    setSelectedId(null);
    flash(`Loaded “${next.name}”`);
  };

  const onDragStartLibrary = (e: DragEvent, widgetId: WidgetId) => {
    e.dataTransfer.setData('application/x-hs-widget', widgetId);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const onDropCanvas = (e: DragEvent) => {
    e.preventDefault();
    if (readOnly) return;
    const widgetId = e.dataTransfer.getData('application/x-hs-widget') as WidgetId;
    if (widgetId && getWidget(widgetId)) addWidget(widgetId);
  };

  const moveItem = (instanceId: string, dir: -1 | 1) => {
    if (!layout || readOnly) return;
    const idx = layout.items.findIndex((i) => i.instanceId === instanceId);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= layout.items.length) return;
    const items = [...layout.items];
    [items[idx], items[j]] = [items[j], items[idx]];
    commit({ ...layout, items });
  };

  const openPublish = () => {
    if (!layout?.items.length) {
      flash('Add at least one widget before publishing');
      return;
    }
    saveLayout(layout);
    setPublishLabel(layout.name || 'My dashboard');
    setPublishedUrl(null);
    setPublishError(null);
    setCopied(false);
    setPublishOpen(true);
  };

  const publishBoard = async () => {
    if (!layout || !authToken) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await fetch(`${API_BASE}/api/demo-access/tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          label: publishLabel.trim() || layout.name,
          venueId: data.venueId,
          linkType: 'custom-dashboard',
          expiresInDays: publishExpires ? Number(publishExpires) : null,
          layout,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setPublishError(body?.error || 'Failed to publish link');
        return;
      }
      const created = await res.json();
      const url = `${window.location.origin}/?demo=${created.token}`;
      setPublishedUrl(url);
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch { /* clipboard may be blocked */ }
    } catch {
      setPublishError('Failed to publish link');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 justify-between rounded-lg border border-gray-700/80 bg-gray-800/40 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <LayoutDashboard className="w-4 h-4 text-cyan-400 shrink-0" />
            <input
              value={layout?.name ?? 'My dashboard'}
              onChange={(e) => layout && commit({ ...layout, name: e.target.value })}
              className="bg-transparent text-sm font-medium text-white border-b border-transparent focus:border-cyan-500/50 outline-none max-w-[220px]"
              disabled={!canEdit}
            />
            {notice && <span className="text-[11px] text-cyan-300">{notice}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-gray-600 text-gray-300 hover:bg-gray-700/60"
            >
              {editing ? <Eye className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
              {editing ? 'Preview' : 'Edit'}
            </button>
            <button
              type="button"
              onClick={() => layout && commit(layout, true)}
              disabled={!layout}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-cyan-600/80 hover:bg-cyan-500 text-white disabled:opacity-40"
            >
              <Save className="w-3 h-3" /> Save
            </button>
            {isSuperadmin && (
              <button
                type="button"
                onClick={openPublish}
                disabled={!layout?.items.length}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/10 disabled:opacity-40"
                title="Publish a view-only public link (like Demo Links)"
              >
                <Link2 className="w-3 h-3" /> Publish
              </button>
            )}
            {layout && (
              <button
                type="button"
                onClick={() => {
                  deleteLayout(layout.id);
                  setLayout(getActiveLayout());
                  setSelectedId(null);
                  flash('Dashboard deleted');
                }}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-gray-600 text-gray-400 hover:text-rose-300"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {canEdit && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[11px] text-gray-500 self-center mr-1">Templates</span>
          {DASHBOARD_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => applyTemplate(t.id)}
              className="px-2 py-1 text-[11px] rounded-md border border-gray-700 text-gray-300 hover:border-cyan-500/40 hover:text-white"
            >
              {t.name}
            </button>
          ))}
          {saved.length > 0 && (
            <>
              <span className="text-[11px] text-gray-500 self-center ml-2 mr-1">Saved</span>
              {saved.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    setActiveLayoutId(l.id);
                    setLayout(l);
                    setSelectedId(null);
                  }}
                  className={`px-2 py-1 text-[11px] rounded-md border ${
                    layout?.id === l.id
                      ? 'border-cyan-500/50 text-cyan-200'
                      : 'border-gray-700 text-gray-300 hover:border-gray-500'
                  }`}
                >
                  {l.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      <div
        ref={builderGridRef}
        className={`grid gap-3 items-start ${canEdit ? 'lg:grid-cols-[240px_1fr_220px]' : 'grid-cols-1'}`}
      >
        {canEdit && (
          <aside className="rounded-lg border border-gray-700/80 bg-gray-800/40 p-2 space-y-2 lg:sticky lg:top-3 lg:self-start max-h-[calc(100vh-5.5rem)] overflow-y-auto">
            <div className="text-[11px] font-semibold text-white px-1">Component library</div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search widgets…"
              className="w-full bg-gray-900/70 border border-gray-700 rounded-md px-2 py-1 text-xs text-white"
            />
            <div className="flex flex-wrap gap-1">
              {KIND_FILTERS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKindFilter(k)}
                  className={`px-1.5 py-0.5 text-[10px] rounded border ${
                    kindFilter === k
                      ? 'border-cyan-500/50 text-cyan-200'
                      : 'border-gray-700 text-gray-400'
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              {library.map((w) => {
                const usedCount = usedOnBoard.get(w.id) || 0;
                const onBoard = usedCount > 0;
                return (
                  <div
                    key={w.id}
                    draggable
                    onDragStart={(e) => onDragStartLibrary(e, w.id)}
                    className={`rounded-md border px-2 py-1.5 cursor-grab active:cursor-grabbing ${
                      onBoard
                        ? 'border-cyan-500/35 bg-cyan-950/20 hover:border-cyan-500/55'
                        : 'border-gray-700/80 bg-gray-900/40 hover:border-cyan-500/40'
                    }`}
                  >
                    <div className="flex items-start gap-1.5">
                      <GripVertical className="w-3 h-3 text-gray-600 mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <div className="text-[11px] font-medium text-white truncate">{w.name}</div>
                          {onBoard && (
                            <span
                              className="shrink-0 inline-flex items-center gap-0.5 px-1 py-px rounded text-[9px] font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                              title={usedCount > 1 ? `${usedCount} on this dashboard` : 'Already on this dashboard'}
                            >
                              <Check className="w-2.5 h-2.5" />
                              {usedCount > 1 ? `On board ×${usedCount}` : 'On board'}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-gray-500 line-clamp-2">{w.description}</div>
                        <div className="text-[9px] text-gray-600 mt-0.5">{w.kind} · {w.sources[0]}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => addWidget(w.id)}
                        className="ml-auto p-0.5 text-cyan-400 hover:text-cyan-300"
                        title={onBoard ? 'Add another' : 'Add'}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        )}

        <main
          onDragOver={(e) => canEdit && e.preventDefault()}
          onDrop={canEdit ? onDropCanvas : undefined}
          className={`min-h-[420px] rounded-lg border ${
            canEdit ? 'border-dashed border-gray-600 bg-gray-900/20' : 'border-transparent'
          } p-2`}
        >
          {!layout?.items.length ? (
            <div className="h-full min-h-[360px] flex flex-col items-center justify-center gap-3 text-center px-4">
              <p className="text-sm text-gray-300">
                {readOnly ? 'This shared board has no widgets.' : 'Start from a template or drag widgets here'}
              </p>
              {!readOnly && (
                <div className="flex flex-wrap gap-2 justify-center">
                  {DASHBOARD_TEMPLATES.filter((t) => t.id !== 'tpl-blank').map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => applyTemplate(t.id)}
                      className="px-3 py-1.5 text-xs rounded-md bg-cyan-600/80 text-white hover:bg-cyan-500"
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-12 gap-2">
              {layout.items.map((item) => {
                const def = getWidget(item.widgetId);
                const selectedTile = item.instanceId === selectedId;
                return (
                  <div
                    key={item.instanceId}
                    ref={(el) => {
                      if (el) tileRefs.current.set(item.instanceId, el);
                      else tileRefs.current.delete(item.instanceId);
                    }}
                    style={{
                      gridColumn: `span ${item.colSpan} / span ${item.colSpan}`,
                      minHeight: rowHeightPx(item.rowSpan),
                    }}
                    className={`relative ${canEdit && selectedTile ? 'ring-1 ring-cyan-500/60 rounded-lg' : ''}`}
                    onClick={() => canEdit && setSelectedId(item.instanceId)}
                  >
                    {canEdit && (
                      <div className="absolute top-1 right-1 z-10 flex gap-0.5">
                        <button
                          type="button"
                          className="px-1 text-[10px] rounded bg-gray-900/80 text-gray-300 border border-gray-600"
                          onClick={(e) => { e.stopPropagation(); moveItem(item.instanceId, -1); }}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="px-1 text-[10px] rounded bg-gray-900/80 text-gray-300 border border-gray-600"
                          onClick={(e) => { e.stopPropagation(); moveItem(item.instanceId, 1); }}
                        >
                          ↓
                        </button>
                      </div>
                    )}
                    <div className="h-full" style={{ minHeight: rowHeightPx(item.rowSpan) - 4 }}>
                      <WidgetRenderer widgetId={item.widgetId} ctx={data} />
                    </div>
                    {canEdit && (
                      <div className="absolute bottom-1 left-1 text-[9px] text-gray-500 bg-gray-950/70 px-1 rounded">
                        {def.name}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </main>

        {canEdit && (
          <aside
            className="rounded-lg border border-gray-700/80 bg-gray-800/40 p-2 space-y-2 lg:sticky lg:top-3 lg:self-start max-h-[calc(100vh-5.5rem)] overflow-y-auto shadow-lg shadow-black/20 transition-[margin] duration-200"
            style={{ marginTop: inspectorAlign > 0 ? inspectorAlign : undefined }}
          >
            <div className="text-[11px] font-semibold text-white px-1">Inspector</div>
            {!selected ? (
              <p className="text-[11px] text-gray-500 px-1">Select a tile on the canvas</p>
            ) : (
              <>
                <div className="text-xs text-white font-medium px-1">
                  {getWidget(selected.widgetId).name}
                </div>
                <p className="text-[10px] text-gray-500 px-1">
                  {getWidget(selected.widgetId).description}
                </p>
                <div className="space-y-1 px-1">
                  <div className="text-[10px] text-gray-400">Size</div>
                  {SIZE_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        if (!layout) return;
                        commit({
                          ...layout,
                          items: layout.items.map((i) =>
                            i.instanceId === selected.instanceId
                              ? { ...i, colSpan: p.colSpan, rowSpan: p.rowSpan }
                              : i),
                        });
                      }}
                      className={`block w-full text-left px-2 py-1 text-[11px] rounded border ${
                        selected.colSpan === p.colSpan && selected.rowSpan === p.rowSpan
                          ? 'border-cyan-500/50 text-cyan-200'
                          : 'border-gray-700 text-gray-300'
                      }`}
                    >
                      {p.label} ({p.colSpan}×{p.rowSpan})
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={removeSelected}
                  className="w-full mt-2 px-2 py-1.5 text-xs rounded-md border border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
                >
                  Remove tile
                </button>
                <p className="text-[10px] text-gray-600 px-1 pt-2">
                  Maps on board: {mapCount}/{MAX_MAP_TILES}
                </p>
              </>
            )}
          </aside>
        )}
      </div>

      {publishOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setPublishOpen(false)}
        >
          <div
            className="w-[28rem] max-w-[94vw] rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-cyan-400" /> Publish public link
                </h3>
                <p className="text-[11px] text-gray-500 mt-1">
                  View-only full page — no editor or inspector. Same Demo Links system.
                </p>
              </div>
              <button type="button" onClick={() => setPublishOpen(false)} className="p-1 text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Label</label>
              <input
                value={publishLabel}
                onChange={(e) => setPublishLabel(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">Expires</label>
              <select
                value={publishExpires}
                onChange={(e) => setPublishExpires(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-lg text-white"
              >
                <option value="">Never</option>
                <option value="1">1 day</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
              </select>
            </div>
            {publishedUrl ? (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 space-y-2">
                <p className="text-xs text-emerald-300">Link ready — share this URL:</p>
                <p className="text-[11px] font-mono text-gray-300 break-all">{publishedUrl}</p>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(publishedUrl);
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 2000);
                    } catch { /* ignore */ }
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-gray-800 text-white border border-gray-600"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={publishBoard}
                disabled={publishing}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-60"
              >
                <Link2 className="w-4 h-4" />
                {publishing ? 'Generating…' : 'Generate public link'}
              </button>
            )}
            {publishError && <p className="text-xs text-red-400">{publishError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
