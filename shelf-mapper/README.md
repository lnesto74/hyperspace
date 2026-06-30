# Shelf Mapper

Web app for mapping product categories onto store floorplans. Customers open a share link, drop numbered pins on shelves, and assign categories. Owners create projects and export results.

## Quick start (local mode, no Supabase)

```bash
cd shelf-mapper
npm install
cp .env.local.example .env.local
# NEXT_PUBLIC_PERSISTENCE=local is the default
npm run dev
```

Open http://localhost:3000 — a **Treviglio** project is auto-seeded in localStorage.

**Test share link:** http://localhost:3000/m/treviglio-demo

**Results (owner):** http://localhost:3000/m/treviglio-demo/results?secret=treviglio-owner

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_PERSISTENCE` | No | `local` (default) or `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase only | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase only | Anon/public key |
| `SUBMIT_WEBHOOK_URL` | No | POST on customer submit (Slack/email bridge) |
| `NEXT_PUBLIC_RESULTS_SECRET` | No | Global fallback secret for results page |

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com)
2. Run `supabase/schema.sql` in the SQL Editor
3. Set env vars:
   ```
   NEXT_PUBLIC_PERSISTENCE=supabase
   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   ```
4. The schema seeds a Treviglio project with share token `treviglio-demo`

### Share token header

Supabase RLS uses `x-share-token` request header. The client sets this automatically on all pin/project mutations.

## Deploy to Vercel

1. Push `shelf-mapper/` to GitHub (or deploy from monorepo root with **Root Directory** = `shelf-mapper`)
2. Import project in [vercel.com/new](https://vercel.com/new)
3. Set environment variables (at minimum `NEXT_PUBLIC_PERSISTENCE`; add Supabase vars if using cloud persistence)
4. Deploy

**Share link format:** `https://your-app.vercel.app/m/{share_token}`

Copy from the owner dashboard or use the seeded link:
`https://your-app.vercel.app/m/treviglio-demo`

## Workflow

1. **Owner** → `/` → create project → copy share link
2. **Customer** → `/m/{token}` → place pins, add categories, Submit
3. **Owner** → `/m/{token}/results?secret={owner_secret}` → view table + export Excel/CSV/JSON

## Tech

- Next.js 15 App Router, TypeScript, Tailwind
- `react-zoom-pan-pinch` for map interaction
- Normalised pin coordinates (0–1) relative to image natural size
- SheetJS (`xlsx`) for Excel export
- Italian UI via `lib/i18n.ts`
