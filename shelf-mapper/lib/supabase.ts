import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import type { Pin, Project, ProjectWithPinCount } from "./types";
import { generateSecret, generateToken, isSupabaseConfigured, isApiPersistence } from "./utils";
import {
  listProjectsApi,
  getProjectByTokenApi,
  getPinsApi,
  savePinApi,
  deletePinApi,
  submitProjectApi,
} from "./api";

const LOCAL_PROJECTS_KEY = "shelf-mapper:projects";
const LOCAL_PINS_PREFIX = "shelf-mapper:pins:";

let supabaseClient: SupabaseClient | null = null;
let clientToken = "";

export function getSupabase(shareToken = ""): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!supabaseClient || (shareToken && shareToken !== clientToken)) {
    clientToken = shareToken;
    supabaseClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: shareToken ? { "x-share-token": shareToken } : {},
        },
      },
    );
  }
  return supabaseClient;
}

// ─── Local storage helpers ───────────────────────────────────────────────────

function readLocalProjects(): Project[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_PROJECTS_KEY);
    return raw ? (JSON.parse(raw) as Project[]) : [];
  } catch {
    return [];
  }
}

function writeLocalProjects(projects: Project[]): void {
  localStorage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify(projects));
}

function readLocalPins(projectId: string): Pin[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${LOCAL_PINS_PREFIX}${projectId}`);
    return raw ? (JSON.parse(raw) as Pin[]) : [];
  } catch {
    return [];
  }
}

function writeLocalPins(projectId: string, pins: Pin[]): void {
  localStorage.setItem(`${LOCAL_PINS_PREFIX}${projectId}`, JSON.stringify(pins));
}

// ─── Projects ──────────────────────────────────────────────────────────────

export async function listProjects(): Promise<ProjectWithPinCount[]> {
  if (isApiPersistence()) return listProjectsApi();

  const client = getSupabase();
  if (client) {
    const { data: projects, error } = await client
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    if (!projects) return [];

    const result: ProjectWithPinCount[] = [];
    for (const p of projects as Project[]) {
      const { count } = await client
        .from("pins")
        .select("*", { count: "exact", head: true })
        .eq("project_id", p.id);
      result.push({ ...p, pin_count: count ?? 0 });
    }
    return result;
  }

  const projects = readLocalProjects();
  return projects.map((p) => ({
    ...p,
    pin_count: readLocalPins(p.id).length,
  }));
}

export async function getProjectByToken(shareToken: string): Promise<Project | null> {
  if (isApiPersistence()) return getProjectByTokenApi(shareToken);

  const client = getSupabase(shareToken);
  if (client) {
    const { data, error } = await client
      .from("projects")
      .select("*")
      .eq("share_token", shareToken)
      .maybeSingle();
    if (error) throw error;
    return data as Project | null;
  }

  return readLocalProjects().find((p) => p.share_token === shareToken) ?? null;
}

export async function createProject(params: {
  name: string;
  floorplanUrl: string;
  imageW: number;
  imageH: number;
}): Promise<Project> {
  if (isApiPersistence()) {
    throw new Error("Create projects from Hyperspace Demo Links panel");
  }

  const now = new Date().toISOString();
  const project: Project = {
    id: uuidv4(),
    name: params.name,
    floorplan_url: params.floorplanUrl,
    image_w: params.imageW,
    image_h: params.imageH,
    share_token: generateToken(),
    owner_secret: generateSecret(),
    submitted_at: null,
    locked: false,
    created_at: now,
  };

  const client = getSupabase();
  if (client) {
    const { data, error } = await client.from("projects").insert(project).select().single();
    if (error) throw error;
    return data as Project;
  }

  const projects = readLocalProjects();
  projects.unshift(project);
  writeLocalProjects(projects);
  return project;
}

export async function submitProject(projectId: string, shareToken: string): Promise<void> {
  if (isApiPersistence()) return submitProjectApi(projectId, shareToken);

  const client = getSupabase(shareToken);
  const now = new Date().toISOString();

  if (client) {
    const { error } = await client
      .from("projects")
      .update({ submitted_at: now })
      .eq("id", projectId)
      .eq("share_token", shareToken);
    if (error) throw error;
    return;
  }

  const projects = readLocalProjects();
  const idx = projects.findIndex((p) => p.id === projectId);
  if (idx >= 0) {
    projects[idx] = { ...projects[idx], submitted_at: now };
    writeLocalProjects(projects);
  }
}

// ─── Pins ──────────────────────────────────────────────────────────────────

export async function getPins(projectId: string, shareToken: string): Promise<Pin[]> {
  if (isApiPersistence()) return getPinsApi(projectId, shareToken);

  const client = getSupabase(shareToken);
  if (client) {
    const { data, error } = await client
      .from("pins")
      .select("*")
      .eq("project_id", projectId)
      .order("number", { ascending: true });
    if (error) throw error;
    return (data as Pin[]) ?? [];
  }

  // Local: verify token matches
  const project = readLocalProjects().find((p) => p.id === projectId);
  if (!project || project.share_token !== shareToken) return [];
  return readLocalPins(projectId).sort((a, b) => a.number - b.number);
}

export async function savePin(pin: Pin, shareToken: string): Promise<Pin> {
  if (isApiPersistence()) return savePinApi(pin, shareToken);

  const now = new Date().toISOString();
  const updated: Pin = { ...pin, updated_at: now };

  const client = getSupabase(shareToken);
  if (client) {
    const { data, error } = await client
      .from("pins")
      .upsert(updated)
      .select()
      .single();
    if (error) throw error;
    return data as Pin;
  }

  const projects = readLocalProjects();
  const project = projects.find((p) => p.id === pin.project_id);
  if (!project || project.share_token !== shareToken) throw new Error("Unauthorized");

  const pins = readLocalPins(pin.project_id);
  const idx = pins.findIndex((p) => p.id === pin.id);
  if (idx >= 0) {
    pins[idx] = updated;
  } else {
    pins.push({ ...updated, created_at: pin.created_at || now });
  }
  writeLocalPins(pin.project_id, pins);
  return updated;
}

export async function deletePin(
  pinId: string,
  projectId: string,
  shareToken: string,
): Promise<void> {
  if (isApiPersistence()) return deletePinApi(pinId, projectId, shareToken);

  const client = getSupabase(shareToken);
  if (client) {
    const { error } = await client.from("pins").delete().eq("id", pinId);
    if (error) throw error;
    return;
  }

  const project = readLocalProjects().find((p) => p.id === projectId);
  if (!project || project.share_token !== shareToken) throw new Error("Unauthorized");

  const pins = readLocalPins(projectId).filter((p) => p.id !== pinId);
  writeLocalPins(projectId, pins);
}

export async function saveAllPins(
  pins: Pin[],
  projectId: string,
  shareToken: string,
): Promise<void> {
  const client = getSupabase(shareToken);
  if (client) {
    if (pins.length === 0) return;
    const { error } = await client.from("pins").upsert(pins);
    if (error) throw error;
    return;
  }

  const project = readLocalProjects().find((p) => p.id === projectId);
  if (!project || project.share_token !== shareToken) throw new Error("Unauthorized");
  writeLocalPins(projectId, pins);
}

export function createPin(params: {
  projectId: string;
  number: number;
  x: number;
  y: number;
}): Pin {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    project_id: params.projectId,
    number: params.number,
    x: params.x,
    y: params.y,
    label: null,
    categories: [],
    note: null,
    created_at: now,
    updated_at: now,
  };
}

/** Seed Treviglio — local mode only; production uses backend seed */
export function seedTreviglioLocal(): Project | null {
  if (isApiPersistence()) return null;
  if (typeof window === "undefined") return null;
  const existing = readLocalProjects().find((p) => p.name === "Treviglio");
  if (existing) return existing;

  const project = createProjectSync({
    name: "Treviglio",
    floorplanUrl: "/floorplans/treviglio.png",
    imageW: 2600,
    imageH: 4188,
    shareToken: "treviglio-demo",
    ownerSecret: "treviglio-owner",
  });
  return project;
}

function createProjectSync(params: {
  name: string;
  floorplanUrl: string;
  imageW: number;
  imageH: number;
  shareToken?: string;
  ownerSecret?: string;
}): Project {
  const now = new Date().toISOString();
  const project: Project = {
    id: uuidv4(),
    name: params.name,
    floorplan_url: params.floorplanUrl,
    image_w: params.imageW,
    image_h: params.imageH,
    share_token: params.shareToken ?? generateToken(),
    owner_secret: params.ownerSecret ?? generateSecret(),
    submitted_at: null,
    locked: false,
    created_at: now,
  };
  const projects = readLocalProjects();
  projects.unshift(project);
  writeLocalProjects(projects);
  return project;
}

export async function uploadFloorplan(file: File): Promise<{
  url: string;
  width: number;
  height: number;
}> {
  const dimensions = await loadImageDimensions(file);

  const client = getSupabase();
  if (client) {
    const ext = file.name.split(".").pop() ?? "png";
    const path = `floorplans/${uuidv4()}.${ext}`;
    const { error } = await client.storage.from("floorplans").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
    });
    if (error) throw error;
    const { data } = client.storage.from("floorplans").getPublicUrl(path);
    return { url: data.publicUrl, ...dimensions };
  }

  // Local fallback: use object URL
  const url = URL.createObjectURL(file);
  return { url, ...dimensions };
}

function loadImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export async function loadImageDimensionsFromUrl(
  url: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = url;
  });
}
