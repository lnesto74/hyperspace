import type { DashboardLayout } from './types';

const KEY = 'hyperspace.customDashboard.v1';

interface Store {
  activeId: string | null;
  layouts: DashboardLayout[];
}

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { activeId: null, layouts: [] };
    const parsed = JSON.parse(raw) as Store;
    if (!Array.isArray(parsed.layouts)) return { activeId: null, layouts: [] };
    return parsed;
  } catch {
    return { activeId: null, layouts: [] };
  }
}

function write(store: Store) {
  localStorage.setItem(KEY, JSON.stringify(store));
}

export function listLayouts(): DashboardLayout[] {
  return read().layouts.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getActiveLayout(): DashboardLayout | null {
  const store = read();
  if (!store.activeId) return store.layouts[0] ?? null;
  return store.layouts.find((l) => l.id === store.activeId) ?? store.layouts[0] ?? null;
}

export function saveLayout(layout: DashboardLayout) {
  const store = read();
  const next = { ...layout, updatedAt: Date.now() };
  const idx = store.layouts.findIndex((l) => l.id === next.id);
  if (idx >= 0) store.layouts[idx] = next;
  else store.layouts.unshift(next);
  store.activeId = next.id;
  write(store);
  return next;
}

export function setActiveLayoutId(id: string) {
  const store = read();
  store.activeId = id;
  write(store);
}

export function deleteLayout(id: string) {
  const store = read();
  store.layouts = store.layouts.filter((l) => l.id !== id);
  if (store.activeId === id) store.activeId = store.layouts[0]?.id ?? null;
  write(store);
}
