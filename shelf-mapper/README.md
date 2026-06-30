# Shelf Mapper

Customer tool for mapping product categories onto store floorplans. Deployed on **DigitalOcean** as part of the Hyperspace stack at `app.hyspace.app/m/<token>`.

## Production (DigitalOcean)

Deploy with the same rsync + docker compose pattern as the rest of Hyperspace:

```bash
chmod +x scripts/deploy-shelf-mapper.sh
./scripts/deploy-shelf-mapper.sh
```

Or manually (matches your existing workflow):

```bash
HOST=root@100.76.196.2

# Backend API + schema
rsync -av backend/routes/shelfMapper.js backend/routes/demoAccess.js $HOST:/opt/hyperspace/backend/routes/
rsync -av backend/database/schema.js $HOST:/opt/hyperspace/backend/database/
rsync -av backend/server.js $HOST:/opt/hyperspace/backend/

# Frontend Demo Links panel
rsync -av frontend/src/components/admin/DemoLinksModal.tsx $HOST:/opt/hyperspace/frontend/src/components/admin/
rsync -av frontend/src/config/demo.ts $HOST:/opt/hyperspace/frontend/src/config/

# Shelf mapper app + Caddy routes
rsync -av --exclude node_modules --exclude .next shelf-mapper/ $HOST:/opt/hyperspace/shelf-mapper/
rsync -av deploy/Caddyfile docker-compose.prod.yml $HOST:/opt/hyperspace/

ssh $HOST 'cd /opt/hyperspace && \
  docker compose -f docker-compose.prod.yml build backend frontend shelf-mapper && \
  docker compose -f docker-compose.prod.yml up -d backend frontend shelf-mapper caddy'
```

## Create a public link

1. Open Hyperspace → **Demo Links** (superadmin)
2. Select **Shelf mapper** tab
3. Add a label (e.g. "Treviglio scaffali") → **Generate shelf mapper link**
4. Send the customer: `https://app.hyspace.app/m/<token>`

Revoking the link in Demo Links also blocks mapper access (token-gated).

**Pre-seeded test link:** `https://app.hyspace.app/m/treviglio-demo`  
**Owner results:** `https://app.hyspace.app/m/treviglio-demo/results?secret=treviglio-owner`

## Local dev

```bash
cd shelf-mapper
npm install
cp .env.local.example .env.local   # NEXT_PUBLIC_PERSISTENCE=local
npm run dev
```

## Architecture on DO

```
app.hyspace.app/m/*     → shelf-mapper container (Next.js)
app.hyspace.app/api/shelf-mapper/* → backend (SQLite)
```

Persistence mode in production: `NEXT_PUBLIC_PERSISTENCE=api` (no Supabase required).

## Env vars (production)

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_PERSISTENCE` | `api` |
| `NEXT_PUBLIC_API_BASE` | empty (same origin) |

Optional: `SUBMIT_WEBHOOK_URL` on shelf-mapper for Slack/email on customer submit.
