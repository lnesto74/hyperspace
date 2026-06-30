export interface Project {
  id: string;
  name: string;
  floorplan_url: string;
  image_w: number;
  image_h: number;
  share_token: string;
  owner_secret: string;
  submitted_at: string | null;
  locked: boolean;
  created_at: string;
}

export interface Pin {
  id: string;
  project_id: string;
  number: number;
  x: number;
  y: number;
  label: string | null;
  categories: string[];
  note: string | null;
  created_at: string;
  updated_at: string;
}

export type PersistenceMode = "local" | "supabase";

export interface ProjectWithPinCount extends Project {
  pin_count: number;
}

export interface MapperState {
  project: Project;
  pins: Pin[];
}

export interface PinDraft {
  label: string;
  categories: string[];
  note: string;
}

export interface ExportRow {
  number: number;
  label: string;
  categories: string;
  note: string;
  x: number;
  y: number;
}
