#!/usr/bin/env node
/**
 * Launcher stub — run the simulator from the backend package (better-sqlite3 lives there).
 *
 *   docker compose -f docker-compose.prod.yml exec backend \
 *     node scripts/peble_param_sim.mjs --venue ... --campaign ... --start-ts ... --end-ts ...
 */

console.error(`
Run PEBLE simulation inside the backend container:

  docker compose -f docker-compose.prod.yml exec backend \\
    node scripts/peble_param_sim.mjs \\
    --venue 55fdd53b-3298-4355-97c0-b4e789b11d06 \\
    --campaign 3f54a978-f064-4d34-abae-a9e3b583b2d0 \\
    --start-ts 1779606900000 --end-ts 1779700500000

Default DB: /data/db/hyperspace.db (not replay_insight.db)
`);
process.exit(1);
