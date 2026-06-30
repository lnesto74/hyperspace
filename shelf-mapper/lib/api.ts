/**
 * API persistence — talks to Hyperspace backend SQLite on DigitalOcean.
 */
import type { Pin, Project, ProjectWithPinCount } from "./types";
import { getApiBase } from "./utils";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/shelf-mapper${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `API ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function isApiConfigured(): boolean {
  return true;
}

export async function listProjectsApi(): Promise<ProjectWithPinCount[]> {
  return apiFetch<ProjectWithPinCount[]>("/projects");
}

export async function getProjectByTokenApi(shareToken: string): Promise<Project | null> {
  try {
    return await apiFetch<Project>(`/projects/${encodeURIComponent(shareToken)}`);
  } catch {
    return null;
  }
}

export async function getPinsApi(projectId: string, shareToken: string): Promise<Pin[]> {
  void projectId;
  return apiFetch<Pin[]>(`/projects/${encodeURIComponent(shareToken)}/pins`);
}

export async function savePinApi(pin: Pin, shareToken: string): Promise<Pin> {
  return apiFetch<Pin>(
    `/projects/${encodeURIComponent(shareToken)}/pins/${encodeURIComponent(pin.id)}`,
    { method: "PUT", body: JSON.stringify(pin) },
  );
}

export async function deletePinApi(
  pinId: string,
  projectId: string,
  shareToken: string,
): Promise<void> {
  void projectId;
  await apiFetch(`/projects/${encodeURIComponent(shareToken)}/pins/${encodeURIComponent(pinId)}`, {
    method: "DELETE",
  });
}

export async function submitProjectApi(projectId: string, shareToken: string): Promise<void> {
  void projectId;
  await apiFetch(`/projects/${encodeURIComponent(shareToken)}/submit`, { method: "POST" });
}
