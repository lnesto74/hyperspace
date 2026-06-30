-- Shelf Mapper — Supabase schema
-- Run in Supabase SQL Editor

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  floorplan_url TEXT NOT NULL,
  image_w INT NOT NULL,
  image_h INT NOT NULL,
  share_token TEXT NOT NULL UNIQUE,
  owner_secret TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  submitted_at TIMESTAMPTZ,
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pins
CREATE TABLE IF NOT EXISTS pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number INT NOT NULL,
  x DOUBLE PRECISION NOT NULL CHECK (x >= 0 AND x <= 1),
  y DOUBLE PRECISION NOT NULL CHECK (y >= 0 AND y <= 1),
  label TEXT,
  categories TEXT[] NOT NULL DEFAULT '{}',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, number)
);

CREATE INDEX IF NOT EXISTS pins_project_id_idx ON pins(project_id);

-- RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE pins ENABLE ROW LEVEL SECURITY;

-- Helper: validate share_token from request header
-- Client sends: x-share-token: <token>
CREATE OR REPLACE FUNCTION public.share_token_header() RETURNS TEXT
  LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    current_setting('request.headers', true)::json->>'x-share-token',
    ''
  );
$$;

-- Projects: anyone with valid share_token can read that project
CREATE POLICY "projects_select_by_token" ON projects
  FOR SELECT USING (share_token = share_token_header());

-- Projects: allow insert for anon (owner dashboard uses anon key)
CREATE POLICY "projects_insert_anon" ON projects
  FOR INSERT WITH CHECK (true);

-- Projects: update if token matches (submit, lock)
CREATE POLICY "projects_update_by_token" ON projects
  FOR UPDATE USING (share_token = share_token_header());

-- Projects: list all for owner dashboard (pragmatic: allow select all for anon)
-- For stricter security, use a service role on the dashboard API instead.
CREATE POLICY "projects_select_all" ON projects
  FOR SELECT USING (true);

-- Pins: read/write when project matches token
CREATE POLICY "pins_select_by_token" ON pins
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = pins.project_id
        AND p.share_token = share_token_header()
    )
  );

CREATE POLICY "pins_insert_by_token" ON pins
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = pins.project_id
        AND p.share_token = share_token_header()
    )
  );

CREATE POLICY "pins_update_by_token" ON pins
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = pins.project_id
        AND p.share_token = share_token_header()
    )
  );

CREATE POLICY "pins_delete_by_token" ON pins
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = pins.project_id
        AND p.share_token = share_token_header()
    )
  );

-- Storage bucket for floorplan uploads
INSERT INTO storage.buckets (id, name, public)
  VALUES ('floorplans', 'floorplans', true)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY "floorplans_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'floorplans');

CREATE POLICY "floorplans_anon_upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'floorplans');

-- Seed Treviglio project (update floorplan_url after deploy)
INSERT INTO projects (name, floorplan_url, image_w, image_h, share_token, owner_secret)
VALUES (
  'Treviglio',
  '/floorplans/treviglio.png',
  2600,
  4188,
  'treviglio-demo',
  'treviglio-owner'
)
ON CONFLICT (share_token) DO NOTHING;
