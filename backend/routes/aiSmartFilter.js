import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const router = express.Router();

const OPENAI_API_KEY = () => process.env.OPENAI_API_KEY;
const OPENAI_MODEL = () => 'gpt-4o-mini';
const OPENAI_TIMEOUT = 120000; // 120s - plenty of time

// ─── Global Dictionary Helpers ───────────────────────────────────
// Normalize name for dictionary lookup: lowercase(layer|block)
function makeNameKey(layer, block) {
  const l = (layer || '').toLowerCase().trim();
  const b = (block || '').toLowerCase().trim();
  return `${l}|${b}`;
}

// ─── Multi-Language Retail Terminology ───────────────────────────
// This helps the LLM understand context even without explicit dictionary

const SYSTEM_PROMPT = `You are an expert retail floor plan analyst specializing in DWG/CAD fixture classification for people tracking systems.

Your task is to analyze fixture group names from retail store floor plans and:
1. CLASSIFY each group into a retail category
2. Determine if it should be FILTERED OUT (not relevant for people tracking)
3. Translate multi-language names (Italian, German, English) to understand their meaning

## RETAIL CATEGORIES (for tracking-relevant fixtures):
- **shelf** — Gondola shelves, wall bays, display units, product palettes, promotional cubes
- **fridge** — Refrigerators, freezers, coolers, cold display cases
- **checkout** — ONLY actual cash registers: Cash/Cassa/Kasse modules, POS terminals, self-checkout kiosks. Must have "cash", "cassa", "kasse", "register", "pos", "till" in name. Size typically 1.3-2.7m × 1.5-3m
- **entrance** — Doors, entrance/exit gates, EAS antennas, turnstiles
- **wall** — Perimeter walls, partitions (building structure)
- **pillar** — Columns, structural pillars
- **service_counter** — Bakery, deli, customer service counters

## FILTER OUT (not relevant for people tracking):
- **emergency** — Emergency exit symbols, fire extinguisher markers
- **annotation** — Title blocks, legends, text labels, drawing notes (often have 0×0 size)
- **utility** — Manholes, drains, electrical panels, HVAC elements
- **backofhouse** — Warehouse racks, office furniture, staff areas, technical rooms
- **signage** — Graphics, floor markings, directional arrows
- **accessory** — Small items like badge readers, caps, plugs (< 0.3m)
- **cad_artifact** — NonPlottable layers, extremely large items (>100m), viewport frames, CAD reference geometry
- **zone** — Department zones, area boundaries, region labels (layer contains ZONE, ZONA, REPARTI, AREA, REGION)

## MULTI-LANGUAGE HINTS:

### Italian (common in Italian retail CAD):
- Muro/Muri = Wall | Frigorifero/Frigo = Fridge | Cassa/Casse = Checkout
- Scaffale = Shelf | Banco = Counter | Ingresso/Entrata = Entrance | Uscita = Exit
- Pilastro = Pillar | Emergenza = Emergency | Simbolo = Symbol
- Grande Elettrodomestico = Large Appliances | Piccolo Elettrodomestico = Small Appliances
- Protezione montante = Rack protector (warehouse) | Chiusino = Manhole cover
- Tavolo/Scrivania = Table/Desk (office) | Ufficio = Office | Magazzino = Warehouse
- Riserva = Reserve/Storage | Spogliatoio = Changing room | Ristoro = Break room

### German (common in German retail CAD):
- Möbel = Furniture | Großgeräte = Large appliances | Regal = Shelf
- Kasse = Checkout | Eingang = Entrance | Ausgang = Exit | Wand = Wall

### English:
- L&F = Furniture vendor brand, NOT a checkout indicator
- Palette/Pallet = Display pallets (shelf) | Cube/Cubo = Display cube (shelf)
- Cooler = Fridge

## CHECKOUT RULES (STRICT):
- ONLY classify as checkout if name contains: Cash, Cassa, Kasse, Register, POS, Till
- "Offerbox" = promotional display shelf, NOT checkout
- "TV Podest" = TV display pedestal, NOT checkout (classify as shelf)
- "Highlight Furniture" = display furniture, NOT checkout (classify as shelf)
- "Entrance cubes" = entrance decoration, NOT checkout (classify as entrance or accessory)
- "Dialog Module" = service counter interaction point (classify as service_counter)
- "Working Place Module" = could be service_counter, NOT checkout
- L&F prefix does NOT mean checkout - check the actual item name

## LAYER NAME PATTERNS:
Layers often indicate category:
- *_MURI, *_MURO, *WALL* → wall
- *_PILASTRI, *PILLAR* → pillar
- *_INGRESSO, *ENTRANCE* → entrance
- *_LAYOUT → usually shelves/displays
- *_EMERGENZA, *EMERGENCY* → filter out
- *_RISERVA, *RESERVE* → backofhouse (filter if not in sales floor)
- *_ARREDO_UFFICI, *OFFICE* → backofhouse (filter)
- *_CARTIGLIO, *TITLEBLOCK* → annotation (filter)
- *_ACCESSORI → small accessories (filter if tiny)
- *_QUADRI → electrical panels (filter)
- *_GRAFICA, *_STRISCE* → signage/markings (filter)
- *NONPLOTTABLE*, *NON_PLOTTABLE*, *DEFPOINTS* → CAD artifacts (always filter)
- *ZONE*, *ZONA*, *REPARTI*, *AREA*, *REGION* → Department zones (always filter)
- Items with size > 100m in any dimension → CAD artifacts/viewport frames (always filter)
- Items with size > 8m in BOTH dimensions → Zone boundaries, not physical fixtures (filter)

## OUTPUT FORMAT:
Return a JSON object with:
{
  "analysis_summary": "Brief description of the store type and fixture composition",
  "groups": [
    {
      "group_id": "...",
      "category": "shelf|fridge|checkout|entrance|wall|pillar|service_counter|custom",
      "should_filter": true/false,
      "filter_reason": "emergency|annotation|utility|backofhouse|signage|accessory|null",
      "confidence": 0.0-1.0,
      "translated_name": "English translation if non-English",
      "reasoning": "Brief explanation"
    }
  ],
  "filter_stats": {
    "total_groups": N,
    "to_filter": N,
    "to_keep": N,
    "by_category": { "shelf": N, "wall": N, ... }
  }
}

IMPORTANT:
- Classify ALL groups provided
- Be conservative with filtering — only filter clearly irrelevant items
- Groups with 0×0 size are usually text labels → filter as "annotation"
- Very small items (< 0.3m both dimensions) are usually accessories → consider filtering
- Warehouse/office layer items are backofhouse → filter unless explicitly sales floor
- Items larger than 100m are CAD artifacts or viewport frames → ALWAYS filter as "cad_artifact"
- Layers named "NonPlottable" or "Defpoints" are CAD system layers → ALWAYS filter
- Layers containing "ZONE", "ZONA", "REPARTI" are department zone labels → ALWAYS filter as "zone"
- Items larger than 8m in BOTH width AND depth are zone boundaries, not physical fixtures → ALWAYS filter
- Real shelves are typically 0.5-3m wide × 0.3-1m deep. Anything much larger is a zone boundary.`;

// ─── Build Analysis Prompt ───────────────────────────────────────

function buildAnalysisPrompt(groups) {
  const groupsData = groups.map(g => ({
    group_id: g.group_id,
    layer: g.layer || '(none)',
    block_name: g.block || g.block_name || '(unnamed)',
    fixture_count: g.count,
    size_m: {
      w: (g.size?.w || g.size_w || 0).toFixed(3),
      d: (g.size?.d || g.size_d || 0).toFixed(3)
    }
  }));

  return `Analyze these ${groups.length} fixture groups from a retail store DWG file.

FIXTURE GROUPS:
${JSON.stringify(groupsData, null, 1)}

Classify each group and determine if it should be filtered out for people tracking purposes.
Return valid JSON only.`;
}

// ─── GPT-4o Text Call with Retry ─────────────────────────────────

async function callGpt4oText(prompt, retries = 3) {
  const apiKey = OPENAI_API_KEY();
  const model = OPENAI_MODEL();

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
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
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0,
          max_tokens: 16000,
          seed: 42,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Retry on 502/503/429 errors
      if (response.status === 502 || response.status === 503 || response.status === 429) {
        const waitMs = Math.min(1000 * Math.pow(2, attempt), 30000); // exponential backoff, max 30s
        console.log(`[AI Smart Filter] OpenAI ${response.status}, retry ${attempt}/${retries} in ${waitMs}ms`);
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      const usage = data.usage || {};

      if (!content) {
        throw new Error('Empty response from OpenAI');
      }

      // Parse JSON, handling potential markdown wrapping
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }

      const parsed = JSON.parse(jsonStr);

      return {
        result: parsed,
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      if (attempt === retries) throw err;
      // Retry on network errors
      const waitMs = Math.min(1000 * Math.pow(2, attempt), 30000);
      console.log(`[AI Smart Filter] Error: ${err.message}, retry ${attempt}/${retries} in ${waitMs}ms`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
}

// ─── Route Factory ───────────────────────────────────────────────

export default function createAiSmartFilterRoutes(db) {

  /**
   * POST /api/dwg/import/:importId/ai-smart-filter
   * Analyzes ALL groups using GPT-4o text (no vision) for fast classification + filter recommendations.
   * Handles batching for large imports (>200 groups).
   */
  router.post('/import/:importId/ai-smart-filter', async (req, res) => {
    const startTime = Date.now();
    const { importId } = req.params;
    const forceRerun = req.query.force === 'true';

    try {
      if (!OPENAI_API_KEY()) {
        return res.status(400).json({ error: 'OPENAI_API_KEY not configured on server' });
      }

      // Check cache first
      if (!forceRerun) {
        const cached = db.prepare(`
          SELECT * FROM ai_smart_filter_cache 
          WHERE import_id = ? 
          ORDER BY created_at DESC LIMIT 1
        `).get(importId);
        
        if (cached) {
          console.log(`[AI Smart Filter] Cache hit for import ${importId}`);
          return res.json({
            ...JSON.parse(cached.result_json),
            cached: true,
            model: cached.model,
            latencyMs: 0,
            createdAt: cached.created_at,
          });
        }
      }

      // Load import
      const imp = db.prepare('SELECT * FROM dwg_imports WHERE id = ?').get(importId);
      if (!imp) {
        return res.status(404).json({ error: 'Import not found' });
      }

      // Load all groups
      const groupRows = db.prepare('SELECT * FROM dwg_groups WHERE import_id = ?').all(importId);
      if (groupRows.length === 0) {
        return res.status(400).json({ error: 'No groups in this import' });
      }

      const allGroups = groupRows.map(g => ({
        group_id: g.group_id,
        layer: g.layer,
        block: g.block_name,
        count: g.count,
        size: { w: g.size_w, d: g.size_d },
      }));

      console.log(`[AI Smart Filter] Analyzing ${allGroups.length} groups for import ${importId}`);

      // ═══ STEP 1: Check global dictionary for known names ═══
      const knownClassifications = [];
      const unknownGroups = [];
      
      const dictLookup = db.prepare('SELECT * FROM fixture_name_dictionary WHERE name_key = ?');
      const dictUpdate = db.prepare(`UPDATE fixture_name_dictionary SET usage_count = usage_count + 1, updated_at = datetime('now') WHERE name_key = ?`);
      
      for (const g of allGroups) {
        const key = makeNameKey(g.layer, g.block);
        const cached = dictLookup.get(key);
        
        if (cached) {
          // Found in dictionary — use cached classification
          knownClassifications.push({
            group_id: g.group_id,
            category: cached.category,
            should_filter: cached.should_filter === 1,
            filter_reason: cached.filter_reason,
            confidence: cached.confidence,
            translated_name: cached.translated_name,
            reasoning: `[CACHED] ${cached.reasoning || 'Previously classified'}`,
          });
          dictUpdate.run(key); // Increment usage count
        } else {
          unknownGroups.push(g);
        }
      }
      
      console.log(`[AI Smart Filter] Dictionary hit: ${knownClassifications.length} known, ${unknownGroups.length} unknown`);

      let allClassifications = [...knownClassifications];
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;

      // ═══ STEP 2: Only call OpenAI for UNKNOWN groups ═══
      if (unknownGroups.length > 0) {
        const BATCH_SIZE = 30; // Small batches = faster responses
        const batches = [];
        for (let i = 0; i < unknownGroups.length; i += BATCH_SIZE) {
          batches.push(unknownGroups.slice(i, i + BATCH_SIZE));
        }
        
        console.log(`[AI Smart Filter] Sending ${unknownGroups.length} unknown groups in ${batches.length} batches`);

        const dictInsert = db.prepare(`
          INSERT OR REPLACE INTO fixture_name_dictionary 
          (id, name_key, layer, block_name, category, should_filter, filter_reason, confidence, translated_name, reasoning, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai')
        `);

        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i];
          console.log(`[AI Smart Filter] Processing batch ${i + 1}/${batches.length} (${batch.length} groups)`);

          const prompt = buildAnalysisPrompt(batch);
          const result = await callGpt4oText(prompt);

          totalPromptTokens += result.promptTokens;
          totalCompletionTokens += result.completionTokens;

          if (result.result.groups) {
            for (const c of result.result.groups) {
              allClassifications.push(c);
              
              // Save to global dictionary for future imports
              const g = batch.find(x => x.group_id === c.group_id);
              if (g) {
                const key = makeNameKey(g.layer, g.block);
                dictInsert.run(
                  uuidv4(),
                  key,
                  g.layer,
                  g.block,
                  c.category,
                  c.should_filter ? 1 : 0,
                  c.filter_reason,
                  c.confidence,
                  c.translated_name,
                  c.reasoning
                );
              }
            }
          }
        }
        
        console.log(`[AI Smart Filter] Saved ${unknownGroups.length} new entries to global dictionary`);
      } else {
        console.log(`[AI Smart Filter] All groups found in dictionary — no API calls needed!`);
      }

      // Compute final stats
      const filterStats = {
        total_groups: allGroups.length,
        to_filter: allClassifications.filter(c => c.should_filter).length,
        to_keep: allClassifications.filter(c => !c.should_filter).length,
        by_category: {},
        by_filter_reason: {},
      };

      for (const c of allClassifications) {
        filterStats.by_category[c.category] = (filterStats.by_category[c.category] || 0) + 1;
        if (c.should_filter && c.filter_reason) {
          filterStats.by_filter_reason[c.filter_reason] = (filterStats.by_filter_reason[c.filter_reason] || 0) + 1;
        }
      }

      const latencyMs = Date.now() - startTime;
      console.log(`[AI Smart Filter] Complete: ${latencyMs}ms, ${totalPromptTokens}+${totalCompletionTokens} tokens`);
      console.log(`[AI Smart Filter] Results: ${filterStats.to_keep} keep, ${filterStats.to_filter} filter`);
      console.log(`[AI Smart Filter] Categories:`, JSON.stringify(filterStats.by_category));

      const result = {
        analysis_summary: `Analyzed ${allGroups.length} groups. Recommend keeping ${filterStats.to_keep} and filtering ${filterStats.to_filter}.`,
        groups: allClassifications,
        filter_stats: filterStats,
        tokens: { prompt: totalPromptTokens, completion: totalCompletionTokens },
        latencyMs,
      };

      // Cache result
      const sourceHash = crypto.createHash('md5').update(JSON.stringify(allGroups)).digest('hex').slice(0, 16);
      db.prepare(`
        INSERT INTO ai_smart_filter_cache (id, import_id, source_hash, model, result_json, prompt_tokens, completion_tokens, latency_ms)
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

      res.json({ ...result, cached: false, model: OPENAI_MODEL() });

    } catch (err) {
      const latencyMs = Date.now() - startTime;
      console.error(`[AI Smart Filter] Error after ${latencyMs}ms:`, err.message);
      res.status(500).json({ error: err.message, latencyMs });
    }
  });

  /**
   * POST /api/dwg/import/:importId/apply-smart-filter
   * Applies the AI filter recommendations — deletes filtered groups from the import.
   */
  router.post('/import/:importId/apply-smart-filter', async (req, res) => {
    const { importId } = req.params;
    const { groupIdsToFilter } = req.body;

    try {
      if (!groupIdsToFilter || !Array.isArray(groupIdsToFilter)) {
        return res.status(400).json({ error: 'groupIdsToFilter array required' });
      }

      const imp = db.prepare('SELECT * FROM dwg_imports WHERE id = ?').get(importId);
      if (!imp) {
        return res.status(404).json({ error: 'Import not found' });
      }

      // Get current deleted fixture IDs
      const currentDeleted = JSON.parse(imp.deleted_fixture_ids_json || '[]');
      const rawData = JSON.parse(imp.raw_json || '{}');
      const fixtures = rawData.fixtures || [];

      // Find all fixture IDs belonging to the groups to filter
      const fixtureIdsToDelete = fixtures
        .filter(f => groupIdsToFilter.includes(f.group_id))
        .map(f => f.id);

      // Merge with existing deleted IDs (avoid duplicates)
      const newDeletedSet = new Set([...currentDeleted, ...fixtureIdsToDelete]);
      const newDeletedJson = JSON.stringify([...newDeletedSet]);

      // Update import
      db.prepare(`
        UPDATE dwg_imports 
        SET deleted_fixture_ids_json = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(newDeletedJson, importId);

      console.log(`[AI Smart Filter] Applied filter: ${fixtureIdsToDelete.length} fixtures from ${groupIdsToFilter.length} groups marked as deleted`);

      res.json({
        success: true,
        filtered_groups: groupIdsToFilter.length,
        filtered_fixtures: fixtureIdsToDelete.length,
        total_deleted: newDeletedSet.size,
      });

    } catch (err) {
      console.error('[AI Smart Filter] Apply error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/dwg/import/:importId/apply-ai-mappings
   * Applies AI classification as group mappings.
   */
  router.post('/import/:importId/apply-ai-mappings', async (req, res) => {
    const { importId } = req.params;
    const { classifications } = req.body;

    try {
      if (!classifications || !Array.isArray(classifications)) {
        return res.status(400).json({ error: 'classifications array required' });
      }

      const imp = db.prepare('SELECT * FROM dwg_imports WHERE id = ?').get(importId);
      if (!imp) {
        return res.status(404).json({ error: 'Import not found' });
      }

      // Map AI categories to DWG fixture types
      const categoryToType = {
        'shelf': 'shelf',
        'fridge': 'shelf', // Treat as shelf for 3D purposes
        'checkout': 'checkout',
        'entrance': 'entrance',
        'wall': 'wall',
        'pillar': 'pillar',
        'service_counter': 'shelf',
        'custom': 'custom',
      };

      let mappedCount = 0;
      const insertMapping = db.prepare(`
        INSERT OR REPLACE INTO dwg_mappings (id, import_id, group_id, catalog_asset_id, type)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const c of classifications) {
        if (c.should_filter) continue; // Don't map filtered groups
        
        const type = categoryToType[c.category] || 'custom';
        insertMapping.run(
          uuidv4(),
          importId,
          c.group_id,
          null, // No catalog asset
          type
        );
        mappedCount++;
      }

      console.log(`[AI Smart Filter] Applied ${mappedCount} AI mappings`);

      res.json({
        success: true,
        mapped_groups: mappedCount,
      });

    } catch (err) {
      console.error('[AI Smart Filter] Apply mappings error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
