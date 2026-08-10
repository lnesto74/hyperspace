import { useMemo, useState, type DragEvent } from 'react';
import {
  LayoutDashboard,
  Plus,
  Save,
  Trash2,
  GripVertical,
  Eye,
  Pencil,
} from 'lucide-react';
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
}: {
  data: DashboardDataContext;
}) {
  const [layout, setLayout] = useState<DashboardLayout | null>(() => getActiveLayout());
  const [editing, setEditing] = useState(true);
  const [kindFilter, setKindFilter] = useState<WidgetKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const saved = listLayouts();

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

  const selected = layout?.items.find((i) => i.instanceId === selectedId) ?? null;
  const mapCount = layout?.items.filter((i) => getWidget(i.widgetId).isMap).length ?? 0;

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
    setLayout(next);
    if (persist) {
      saveLayout(next);
      flash('Dashboard saved');
    }
  };

  const addWidget = (widgetId: WidgetId) => {
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
    if (!layout || !selectedId) return;
    commit({ ...layout, items: layout.items.filter((i) => i.instanceId !== selectedId) });
    setSelectedId(null);
  };

  const applyTemplate = (templateId: string) => {
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
    const widgetId = e.dataTransfer.getData('application/x-hs-widget') as WidgetId;
    if (widgetId && getWidget(widgetId)) addWidget(widgetId);
  };

  const moveItem = (instanceId: string, dir: -1 | 1) => {
    if (!layout) return;
    const idx = layout.items.findIndex((i) => i.instanceId === instanceId);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= layout.items.length) return;
    const items = [...layout.items];
    [items[idx], items[j]] = [items[j], items[idx]];
    commit({ ...layout, items });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 justify-between rounded-lg border border-gray-700/80 bg-gray-800/40 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <LayoutDashboard className="w-4 h-4 text-cyan-400 shrink-0" />
          <input
            value={layout?.name ?? 'My dashboard'}
            onChange={(e) => layout && commit({ ...layout, name: e.target.value })}
            className="bg-transparent text-sm font-medium text-white border-b border-transparent focus:border-cyan-500/50 outline-none max-w-[220px]"
            disabled={!editing}
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

      {editing && (
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

      <div className={`grid gap-3 ${editing ? 'lg:grid-cols-[240px_1fr_220px]' : 'grid-cols-1'}`}>
        {editing && (
          <aside className="rounded-lg border border-gray-700/80 bg-gray-800/40 p-2 space-y-2 max-h-[70vh] overflow-y-auto">
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
              {library.map((w) => (
                <div
                  key={w.id}
                  draggable
                  onDragStart={(e) => onDragStartLibrary(e, w.id)}
                  className="rounded-md border border-gray-700/80 bg-gray-900/40 px-2 py-1.5 cursor-grab active:cursor-grabbing hover:border-cyan-500/40"
                >
                  <div className="flex items-start gap-1.5">
                    <GripVertical className="w-3 h-3 text-gray-600 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-white truncate">{w.name}</div>
                      <div className="text-[10px] text-gray-500 line-clamp-2">{w.description}</div>
                      <div className="text-[9px] text-gray-600 mt-0.5">{w.kind} · {w.sources[0]}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => addWidget(w.id)}
                      className="ml-auto p-0.5 text-cyan-400 hover:text-cyan-300"
                      title="Add"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        )}

        <main
          onDragOver={(e) => editing && e.preventDefault()}
          onDrop={editing ? onDropCanvas : undefined}
          className={`min-h-[420px] rounded-lg border ${
            editing ? 'border-dashed border-gray-600 bg-gray-900/20' : 'border-transparent'
          } p-2`}
        >
          {!layout?.items.length ? (
            <div className="h-full min-h-[360px] flex flex-col items-center justify-center gap-3 text-center px-4">
              <p className="text-sm text-gray-300">Start from a template or drag widgets here</p>
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
            </div>
          ) : (
            <div className="grid grid-cols-12 gap-2">
              {layout.items.map((item) => {
                const def = getWidget(item.widgetId);
                const selectedTile = item.instanceId === selectedId;
                return (
                  <div
                    key={item.instanceId}
                    style={{
                      gridColumn: `span ${item.colSpan} / span ${item.colSpan}`,
                      minHeight: rowHeightPx(item.rowSpan),
                    }}
                    className={`relative ${editing && selectedTile ? 'ring-1 ring-cyan-500/60 rounded-lg' : ''}`}
                    onClick={() => editing && setSelectedId(item.instanceId)}
                  >
                    {editing && (
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
                    {editing && (
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

        {editing && (
          <aside className="rounded-lg border border-gray-700/80 bg-gray-800/40 p-2 space-y-2 max-h-[70vh] overflow-y-auto">
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
    </div>
  );
}
