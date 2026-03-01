import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const router = express.Router();

const OPENAI_API_KEY = () => process.env.OPENAI_API_KEY;
const OPENAI_MODEL = () => process.env.OPENAI_MODEL || 'gpt-4o';
const OPENAI_TIMEOUT = 300000; // 5 min — high-detail vision + 276 groups + 16K output tokens

// ─── SVG Renderer ────────────────────────────────────────────────
// Renders ALL original fixtures from a DWG import as a high-contrast
// SVG, then converts to PNG via sharp for GPT-4o Vision.

function renderFixturesToSvg(fixtures, bounds, groups) {
  const pad = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.04;
  const vbX = bounds.minX - pad;
  const vbY = bounds.minY - pad;
  const vbW = (bounds.maxX - bounds.minX) + pad * 2;
  const vbH = (bounds.maxY - bounds.minY) + pad * 2;
  const sw = Math.max(vbW, vbH) * 0.002;

  // Build group_id → color map for visual distinction
  const groupIds = [...new Set(fixtures.map(f => f.group_id).filter(Boolean))];
  const palette = [
    '#6366f1', '#22d3ee', '#f59e0b', '#ef4444', '#10b981',
    '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4',
    '#84cc16', '#e879f9', '#fb923c', '#34d399', '#a78bfa',
  ];
  const groupColor = {};
  groupIds.forEach((gid, i) => { groupColor[gid] = palette[i % palette.length]; });

  let rects = '';
  for (const f of fixtures) {
    const color = groupColor[f.group_id] || '#94a3b8';
    const x = f.pose2d?.x ?? 0;
    const y = f.pose2d?.y ?? 0;
    const rot = f.pose2d?.rot_deg ?? 0;
    const w = Math.abs(f.footprint?.w ?? 1);
    const d = Math.abs(f.footprint?.d ?? 1);
    const points = f.footprint?.points;

    if (points && points.length >= 3) {
      const pts = points.map(p => `${p.x},${p.y}`).join(' ');
      rects += `<polygon points="${pts}" fill="${color}" fill-opacity="0.5" stroke="${color}" stroke-width="${sw}" stroke-opacity="0.8"/>`;
    } else {
      rects += `<rect x="${-w/2}" y="${-d/2}" width="${w}" height="${d}" fill="${color}" fill-opacity="0.5" stroke="${color}" stroke-width="${sw}" stroke-opacity="0.8" transform="translate(${x},${y}) rotate(${rot})"/>`;
    }
  }

  // No text labels — they overlap and obscure the drawing at this scale.
  // Group metadata is passed in the text prompt instead.

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="2048" height="${Math.round(2048 * vbH / vbW)}">
  <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#ffffff"/>
  ${rects}
</svg>`;
}

function escapeXml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Smart Bounds (MAD-based) ────────────────────────────────────
// Uses Median Absolute Deviation to compute bounds that zoom into the
// actual floor plan cluster, ignoring distant stray fixtures.

function computeSmartBounds(fixtures) {
  if (fixtures.length < 10) {
    // Too few — just use full extent
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of fixtures) {
      const x = f.pose2d?.x ?? 0, y = f.pose2d?.y ?? 0;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    return { minX, minY, maxX, maxY };
  }

  const xs = fixtures.map(f => f.pose2d?.x ?? 0).sort((a, b) => a - b);
  const ys = fixtures.map(f => f.pose2d?.y ?? 0).sort((a, b) => a - b);
  const n = xs.length;

  const medianX = xs[Math.floor(n / 2)];
  const medianY = ys[Math.floor(n / 2)];

  const devX = fixtures.map(f => Math.abs((f.pose2d?.x ?? 0) - medianX)).sort((a, b) => a - b);
  const devY = fixtures.map(f => Math.abs((f.pose2d?.y ?? 0) - medianY)).sort((a, b) => a - b);
  const madX = devX[Math.floor(n / 2)];
  const madY = devY[Math.floor(n / 2)];

  const spread = 6;
  return {
    minX: medianX - spread * Math.max(madX, 1),
    maxX: medianX + spread * Math.max(madX, 1),
    minY: medianY - spread * Math.max(madY, 1),
    maxY: medianY + spread * Math.max(madY, 1),
  };
}

// ─── Two-Pass Prompts ────────────────────────────────────────────

function buildGroupSummary(groups, fixtures, bounds) {
  const floorW = bounds.maxX - bounds.minX;
  const floorH = bounds.maxY - bounds.minY;
  // Compute perimeter margin (15% from edge = perimeter)
  const marginX = floorW * 0.15;
  const marginY = floorH * 0.15;

  return groups.map(g => {
    const members = fixtures.filter(f => f.group_id === g.group_id);
    let avgX = 0, avgY = 0;
    if (members.length > 0) {
      avgX = members.reduce((s, f) => s + (f.pose2d?.x ?? 0), 0) / members.length;
      avgY = members.reduce((s, f) => s + (f.pose2d?.y ?? 0), 0) / members.length;
    }
    const normX = floorW > 0 ? ((avgX - bounds.minX) / floorW).toFixed(2) : '0.5';
    const normY = floorH > 0 ? ((avgY - bounds.minY) / floorH).toFixed(2) : '0.5';

    // Position: perimeter vs interior
    const nearPerimeter = (
      avgX < bounds.minX + marginX || avgX > bounds.maxX - marginX ||
      avgY < bounds.minY + marginY || avgY > bounds.maxY - marginY
    );

    // Aspect ratio and area
    const w = g.size?.w || 1;
    const d = g.size?.d || 1;
    const aspectRatio = Math.max(w, d) / Math.min(w, d);

    return {
      group_id: g.group_id,
      block: g.block || null,
      layer: g.layer,
      count: g.count,
      size_mm: { w: Math.round(w), d: Math.round(d) },
      aspect_ratio: +aspectRatio.toFixed(1),
      position_norm: { x: normX, y: normY },
      zone: nearPerimeter ? 'perimeter' : 'interior',
    };
  });
}

function buildPass1Prompt(groups, fixtures, bounds) {
  const floorW = bounds.maxX - bounds.minX;
  const floorH = bounds.maxY - bounds.minY;
  const groupSummary = buildGroupSummary(groups, fixtures, bounds);

  return `You are analyzing a DWG/DXF floor plan of a supermarket (likely Italian). The image shows ALL detected fixtures, color-coded by group.

FLOOR PLAN: ${Math.round(floorW)}mm × ${Math.round(floorH)}mm

FIXTURE GROUPS (with position zone: perimeter=near edge, interior=center of store):
${JSON.stringify(groupSummary, null, 1)}

GOAL: Identify the store's spatial structure ONLY.

## WALLS — BE EXTREMELY CONSERVATIVE
Walls are the OUTER PERIMETER BOUNDARY of the store building — the physical walls that form the shell.
- Typically only 1-5 groups in the ENTIRE store
- They are VERY long, thin elements tracing the store boundary
- They have VERY few instances (usually 1-4 fixtures per wall group)
- They are at the EXTREME perimeter (zone=perimeter, position_norm near 0.0 or 1.0)

⚠️ DO NOT CLASSIFY AS WALLS:
- Groups with many fixtures (count > 5) — those are shelves or equipment
- Parallel rows of similar-sized rectangles — those are GONDOLA SHELVES
- Interior fixtures (zone=interior) — walls don't go through the middle of a store
- Groups whose block name contains: scaffale, gondola, shelf, banco, frigo, cassa, layout, schema

If you are not 100% certain something is a wall, DO NOT include it. You should list AT MOST 5 wall groups.

## ENTRANCES — doors, gates, entrances/exits
Typically 1-3 groups. Look for: porta, ingresso, uscita, door, gate.

## CHECKOUT ZONE — the area where checkout counters are
Provide a normalized bounding box (x,y,w,h in 0-1 range). Usually near the entrance/front of the store.

## LAYOUT — grid aisles, loop, mixed, or unknown

STRICT RULES:
- MAXIMUM 5 wall groups. If unsure → leave it out.
- Groups with count > 5 are NEVER walls.
- Interior groups are NEVER walls.
- Return ONLY valid JSON.

OUTPUT:
{
  "wall_group_ids": ["ONLY true perimeter boundary wall group_ids, MAX 5"],
  "entrance_group_ids": ["door/entrance group_ids"],
  "checkout_zone": { "x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0, "confidence": 0.0 },
  "backofhouse_zone": { "x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0, "confidence": 0.0 },
  "layout_type": "grid|loop|mixed|unknown",
  "layout_notes": "brief description"
}`;
}

function buildPass2Prompt(groups, fixtures, bounds, pass1Result, pass1Reliable) {
  const floorW = bounds.maxX - bounds.minX;
  const floorH = bounds.maxY - bounds.minY;
  const groupSummary = buildGroupSummary(groups, fixtures, bounds);

  // Only exclude wall/entrance groups if Pass 1 was reliable (few wall groups)
  let groupsToClassify;
  const wallIds = new Set(pass1Reliable ? (pass1Result.wall_group_ids || []) : []);
  const entranceIds = new Set(pass1Result.entrance_group_ids || []);
  if (pass1Reliable) {
    groupsToClassify = groupSummary.filter(g => !wallIds.has(g.group_id) && !entranceIds.has(g.group_id));
  } else {
    // Pass 1 was unreliable (too many walls) — send ALL groups
    groupsToClassify = groupSummary;
  }

  const unreliableNote = pass1Reliable
    ? ''
    : `\n⚠️ WARNING: Pass 1 wall detection was unreliable (too many groups marked as walls). IGNORE the wall_group_ids. You must classify ALL groups below, including any that might be walls.\n`;

  return `You are classifying fixtures in a supermarket floor plan. You have structural context from Pass 1.

STRUCTURAL CONTEXT FROM PASS 1:
- Wall groups: ${pass1Reliable ? JSON.stringify(pass1Result.wall_group_ids || []) : '(unreliable — ignored)'}
- Entrance groups: ${JSON.stringify(pass1Result.entrance_group_ids || [])}
- Checkout zone (normalized bbox): ${JSON.stringify(pass1Result.checkout_zone || {})}
- Layout: ${pass1Result.layout_type || 'unknown'} — ${pass1Result.layout_notes || ''}
${unreliableNote}
FLOOR PLAN: ${Math.round(floorW)}mm × ${Math.round(floorH)}mm

FIXTURE GROUPS TO CLASSIFY:
${JSON.stringify(groupsToClassify, null, 1)}

Each group has a "zone" field: "interior" means center of store, "perimeter" means near the store edge.

CLASSIFY each group into ONE category:

1. **shelf** — THE MOST COMMON TYPE. Gondola shelving, wall-mounted shelves, any product display.
   - Parallel rows of rectangles in the INTERIOR of the store = ALWAYS shelf
   - Groups with count >= 5 arranged in regular patterns = shelf
   - Interior zone + elongated rectangles = shelf
   - Aspect ratio 2:1 to 20:1 + interior = almost certainly shelf
   - Italian hints: scaffale, gondola, shelf, LAYOUT, SCHEMA, reparto, corsia
   - ⚡ IN A SUPERMARKET, 60-80% OF ALL GROUPS ARE SHELVES

2. **fridge** — Refrigeration units, freezers, cold cabinets.
   - Usually along PERIMETER walls, not in center aisles
   - Often wider/deeper than standard shelves
   - Italian hints: frigo, banco refrigerato, freezer, friulinox, cold, surgelati

3. **wall** — Physical building walls (the perimeter shell of the store).
   - VERY rare: max 1-5 groups in the entire store
   - ONLY the outer boundary / partitions, NOT interior fixtures
   - Very few instances (count 1-4), very long/thin
   - NEVER classify interior groups as walls
   - NEVER classify groups with count > 5 as walls

4. **checkout** — Cash registers, self-checkout, queue lanes.
   - MUST be near the checkout_zone from Pass 1
   - Italian hints: cassa, checkout, cash, barriera

5. **entrance** — Doors, entrance/exit gates.
   - Italian hints: porta, ingresso, uscita, door, gate

6. **service_counter** — Bakery, deli, fish, cheese counters.
   - Near perimeter, not standard shelving rows
   - Italian hints: banco, gastronomia, pescheria, macelleria, panetteria

7. **custom** — ONLY for genuinely unclassifiable elements (pillars, signage, tiny items).
   - Use VERY sparingly. Groups with count >= 3 are almost never custom.

## CRITICAL DECISION RULES (follow in order):
1. Groups with count >= 5 in interior zone = **shelf** (not wall, not custom)
2. Parallel rows of similar rectangles = **shelf** (this is the #1 pattern in supermarkets)
3. Interior + elongated rectangles = **shelf**
4. Near perimeter + long thin + count <= 3 = possible **wall** (but only if it traces the boundary)
5. Near checkout_zone = **checkout**
6. Perimeter + deep cabinets = **fridge**
7. When in doubt → **shelf**

RESPONSE — valid JSON only:
{
  "classifications": [
    { "group_id": "...", "category": "shelf|fridge|wall|checkout|entrance|service_counter|custom", "confidence": 0.0-1.0, "reasoning": "short explanation" }
  ]
}

You MUST classify EVERY group_id listed above. Do NOT skip any. Do NOT invent group_ids.`;
}

// ─── GPT-4o Vision Call ──────────────────────────────────────────

async function callGpt4oVision(pngBase64, prompt) {
  const apiKey = OPENAI_API_KEY();
  const model = OPENAI_MODEL();

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert architectural floor plan analyst specializing in retail store layouts. You analyze CAD/DWG drawings of supermarkets and grocery stores to classify fixture groups. All images provided are technical architectural drawings. You ALWAYS respond with valid JSON only.'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${pngBase64}`,
                  detail: 'auto',
                },
              },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 16000,
        seed: 42, // deterministic
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    const content = message?.content;
    const usage = data.usage || {};

    // Debug: log the full message structure
    console.log('[AI Classify] Response message keys:', message ? Object.keys(message) : 'null');
    console.log('[AI Classify] finish_reason:', data.choices?.[0]?.finish_reason);
    console.log('[AI Classify] usage:', JSON.stringify(usage));
    if (message?.refusal) {
      console.error('[AI Classify] Model REFUSED:', message.refusal);
      throw new Error(`OpenAI refused request: ${message.refusal}`);
    }

    if (!content) {
      console.error('[AI Classify] Empty content. Full response:', JSON.stringify(data).slice(0, 1000));
      const finishReason = data.choices?.[0]?.finish_reason;
      throw new Error(`Empty response from OpenAI (finish_reason: ${finishReason || 'unknown'})`);
    }

    const finishReason = data.choices?.[0]?.finish_reason;
    console.log('[AI Classify] Content length:', content.length, 'chars. finish_reason:', finishReason, '. First 200:', content.slice(0, 200))

    // Strip markdown code fences if present (model may wrap JSON in ```json ... ```)
    let jsonStr = content.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    }

    // Handle truncated responses (finish_reason: 'length')
    // Try to repair incomplete JSON by closing open structures
    if (finishReason === 'length') {
      console.warn('[AI Classify] Response was TRUNCATED (finish_reason: length). Attempting JSON repair...');
      // Try parsing as-is first, then attempt to close open arrays/objects
      try {
        JSON.parse(jsonStr);
      } catch {
        // Count open brackets
        let openBraces = 0, openBrackets = 0;
        let inString = false, escape = false;
        for (const ch of jsonStr) {
          if (escape) { escape = false; continue; }
          if (ch === '\\') { escape = true; continue; }
          if (ch === '"') { inString = !inString; continue; }
          if (inString) continue;
          if (ch === '{') openBraces++;
          if (ch === '}') openBraces--;
          if (ch === '[') openBrackets++;
          if (ch === ']') openBrackets--;
        }
        // Close any open string, then arrays, then objects
        if (inString) jsonStr += '"';
        // Trim trailing comma or partial value
        jsonStr = jsonStr.replace(/,\s*$/, '');
        while (openBrackets > 0) { jsonStr += ']'; openBrackets--; }
        while (openBraces > 0) { jsonStr += '}'; openBraces--; }
        console.log('[AI Classify] Repaired JSON (last 100 chars):', jsonStr.slice(-100));
      }
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonStr)
    } catch (parseErr) {
      console.error('[AI Classify] JSON parse failed. Last 300 chars:', jsonStr.slice(-300));
      throw new Error(`Failed to parse OpenAI JSON (finish_reason: ${finishReason}): ${parseErr.message}. Content tail: ${jsonStr.slice(-200)}`)
    }

    return {
      result: parsed,
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ─── Route Factory ───────────────────────────────────────────────

export default function createAiClassifyRoutes(db) {

  /**
   * POST /api/dwg/import/:importId/ai-classify
   * Renders original DWG fixtures → PNG → GPT-4o Vision → structured classifications
   * Caches result per import_id.
   * Query params:
   *   ?force=true  — skip cache, re-run
   */
  router.post('/import/:importId/ai-classify', async (req, res) => {
    const startTime = Date.now();
    const { importId } = req.params;
    const forceRerun = req.query.force === 'true';

    try {
      // Check API key
      if (!OPENAI_API_KEY()) {
        return res.status(400).json({ error: 'OPENAI_API_KEY not configured on server' });
      }

      // Check cache first (unless force)
      if (!forceRerun) {
        const cached = db.prepare('SELECT * FROM ai_classify_cache WHERE import_id = ? ORDER BY created_at DESC LIMIT 1').get(importId);
        if (cached) {
          console.log(`[AI Classify] Cache hit for import ${importId}`);
          return res.json({
            classifications: JSON.parse(cached.result_json),
            cached: true,
            model: cached.model,
            latencyMs: 0,
            createdAt: cached.created_at,
          });
        }
      }

      // Load original import data (ALL fixtures, unfiltered)
      const imp = db.prepare('SELECT * FROM dwg_imports WHERE id = ?').get(importId);
      if (!imp) {
        return res.status(404).json({ error: 'Import not found' });
      }

      const rawData = JSON.parse(imp.raw_json || '{}');
      const fixtures = rawData.fixtures || [];
      // Use smart bounds (MAD-based) instead of raw DXF bounds to zoom into the actual floor plan
      const smartBounds = computeSmartBounds(fixtures);
      const bounds = smartBounds;

      if (fixtures.length === 0) {
        return res.status(400).json({ error: 'No fixtures in this import' });
      }

      // Load groups
      const groupRows = db.prepare('SELECT * FROM dwg_groups WHERE import_id = ?').all(importId);
      const allGroups = groupRows.map(g => ({
        group_id: g.group_id,
        layer: g.layer,
        block: g.block_name,
        count: g.count,
        size: { w: g.size_w, d: g.size_d },
      }));

      // Limit to top 60 groups by member count to keep prompt + response manageable.
      // With 276 groups, the prompt is ~43K chars and response needs ~22K tokens
      // which exceeds max_tokens and causes timeouts.
      const MAX_AI_GROUPS = 60;
      const sortedGroups = [...allGroups].sort((a, b) => b.count - a.count);
      const aiGroups = sortedGroups.slice(0, MAX_AI_GROUPS);
      const skippedGroups = sortedGroups.slice(MAX_AI_GROUPS);

      console.log(`[AI Classify] ${allGroups.length} total groups, sending top ${aiGroups.length} to GPT-4o (${skippedGroups.length} small groups auto-classified as custom)`);
      console.log(`[AI Classify] Rendering ${fixtures.length} fixtures from import ${importId}`);

      // 1) Render ALL original fixtures to SVG
      const svg = renderFixturesToSvg(fixtures, bounds, allGroups);

      // 2) Convert SVG → PNG via sharp
      const pngBuffer = await sharp(Buffer.from(svg))
        .png({ quality: 90 })
        .toBuffer();
      const pngBase64 = pngBuffer.toString('base64');

      // Debug: save PNG to disk so user can inspect what OpenAI sees
      const debugDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
      const debugPath = path.join(debugDir, `ai-classify-debug-${importId.slice(0, 8)}.png`);
      fs.writeFileSync(debugPath, pngBuffer);
      console.log(`[AI Classify] Debug PNG saved: ${debugPath} (${(pngBuffer.length / 1024).toFixed(0)}KB)`);
      console.log(`[AI Classify] PNG rendered: ${(pngBuffer.length / 1024).toFixed(0)}KB, sending to GPT-4o Vision...`);

      // ═══ PASS 1: Structural analysis ═══
      console.log(`[AI Classify] === PASS 1: Structural analysis ===`);
      const pass1Prompt = buildPass1Prompt(aiGroups, fixtures, bounds);
      const pass1 = await callGpt4oVision(pngBase64, pass1Prompt);
      const pass1Result = pass1.result;

      console.log(`[AI Classify] Pass 1 done (${pass1.promptTokens}+${pass1.completionTokens} tokens)`);
      console.log(`[AI Classify] Walls: ${(pass1Result.wall_group_ids || []).length} groups, Entrances: ${(pass1Result.entrance_group_ids || []).length} groups`);
      console.log(`[AI Classify] Checkout zone:`, JSON.stringify(pass1Result.checkout_zone || {}));
      console.log(`[AI Classify] Layout: ${pass1Result.layout_type} — ${pass1Result.layout_notes}`);

      // Sanity check: if Pass 1 tagged too many groups as walls, it's unreliable
      const wallCount = (pass1Result.wall_group_ids || []).length;
      const pass1Reliable = wallCount <= 8;
      if (!pass1Reliable) {
        console.warn(`[AI Classify] ⚠️ Pass 1 UNRELIABLE: ${wallCount} wall groups detected (max expected: 5). Will send ALL groups to Pass 2.`);
      }

      // ═══ PASS 2: Fixture classification using structural context ═══
      console.log(`[AI Classify] === PASS 2: Fixture classification (pass1 reliable: ${pass1Reliable}) ===`);
      const pass2Prompt = buildPass2Prompt(aiGroups, fixtures, bounds, pass1Result, pass1Reliable);
      const pass2 = await callGpt4oVision(pngBase64, pass2Prompt);
      const pass2Result = pass2.result;

      const totalPromptTokens = pass1.promptTokens + pass2.promptTokens;
      const totalCompletionTokens = pass1.completionTokens + pass2.completionTokens;
      const latencyMs = Date.now() - startTime;
      console.log(`[AI Classify] Pass 2 done (${pass2.promptTokens}+${pass2.completionTokens} tokens)`);
      console.log(`[AI Classify] Total: ${latencyMs}ms, ${totalPromptTokens}+${totalCompletionTokens} tokens`);

      // 4) Merge Pass 1 + Pass 2 into a single classifications array
      const allClassifications = [];
      const pass2Map = new Map();
      if (pass2Result.classifications && Array.isArray(pass2Result.classifications)) {
        for (const c of pass2Result.classifications) pass2Map.set(c.group_id, c);
      }

      if (pass1Reliable) {
        // Add wall classifications from Pass 1 (only if reliable)
        for (const wid of (pass1Result.wall_group_ids || [])) {
          // Check if Pass 2 also classified this (shouldn't happen if reliable, but safety)
          const p2 = pass2Map.get(wid);
          if (p2) {
            allClassifications.push(p2);
            pass2Map.delete(wid);
          } else {
            allClassifications.push({
              group_id: wid,
              category: 'wall',
              confidence: 0.75,
              reasoning: 'Identified as wall/partition in structural pass',
            });
          }
        }

        // Add entrance classifications from Pass 1
        for (const eid of (pass1Result.entrance_group_ids || [])) {
          const p2 = pass2Map.get(eid);
          if (p2) {
            allClassifications.push(p2);
            pass2Map.delete(eid);
          } else {
            allClassifications.push({
              group_id: eid,
              category: 'entrance',
              confidence: 0.80,
              reasoning: 'Identified as entrance/exit in structural pass',
            });
          }
        }
      }

      // Add all remaining Pass 2 classifications
      for (const c of pass2Map.values()) {
        allClassifications.push(c);
      }

      const result = { classifications: allClassifications };

      // 4b) Auto-classify skipped small groups as "custom"
      for (const sg of skippedGroups) {
        result.classifications.push({
          group_id: sg.group_id,
          category: 'custom',
          confidence: 0.3,
          reasoning: `Auto-classified (small group with ${sg.count} fixtures, not sent to AI)`,
        });
      }

      console.log(`[AI Classify] Final: ${result.classifications.length} classifications (${result.classifications.filter(c => c.category === 'shelf').length} shelf, ${result.classifications.filter(c => c.category === 'wall').length} wall, ${result.classifications.filter(c => c.category === 'checkout').length} checkout, ${result.classifications.filter(c => c.category === 'fridge').length} fridge, ${result.classifications.filter(c => c.category === 'custom').length} custom)`);

      // 5) Cache result
      const sourceHash = crypto.createHash('md5').update(imp.raw_json || '').digest('hex').slice(0, 16);
      db.prepare(`
        INSERT INTO ai_classify_cache (id, import_id, source_hash, model, result_json, prompt_tokens, completion_tokens, latency_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        uuidv4(),
        importId,
        sourceHash,
        OPENAI_MODEL(),
        JSON.stringify(result),
        totalPromptTokens,
        totalCompletionTokens,
        latencyMs
      );

      res.json({
        classifications: result,
        cached: false,
        model: OPENAI_MODEL(),
        latencyMs,
        tokens: { prompt: totalPromptTokens, completion: totalCompletionTokens },
      });

    } catch (err) {
      const latencyMs = Date.now() - startTime;
      console.error(`[AI Classify] Error after ${latencyMs}ms:`, err.message);
      res.status(500).json({ error: err.message, latencyMs });
    }
  });

  /**
   * GET /api/dwg/import/:importId/ai-classify
   * Returns cached AI classification result if available.
   */
  router.get('/import/:importId/ai-classify', (req, res) => {
    try {
      const cached = db.prepare('SELECT * FROM ai_classify_cache WHERE import_id = ? ORDER BY created_at DESC LIMIT 1').get(req.params.importId);
      if (!cached) {
        return res.json({ classifications: null, cached: false });
      }
      res.json({
        classifications: JSON.parse(cached.result_json),
        cached: true,
        model: cached.model,
        latencyMs: cached.latency_ms,
        createdAt: cached.created_at,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
