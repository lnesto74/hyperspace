# AI Smart Filter — Architecture & Logic

## Overview

The AI Smart Filter uses **GPT-4o text analysis** to intelligently classify and filter DWG fixture groups based on multi-language block/layer names. It's designed for retail floor plans with Italian, German, and English terminology.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        DWG Importer Page                                │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │
│  │  GroupListPanel  │  │   PreviewPanel   │  │    MappingPanel      │  │
│  │                  │  │                  │  │                      │  │
│  │  ┌────────────┐  │  │                  │  │                      │  │
│  │  │ AI Quick   │  │  │    2D/3D View    │  │  Type Assignment     │  │
│  │  │ Clean      │──┼──┼─────────────────▶│  │                      │  │
│  │  │ Button     │  │  │                  │  │                      │  │
│  │  └────────────┘  │  │                  │  │                      │  │
│  │        │         │  │                  │  │                      │  │
│  │        ▼         │  │                  │  │                      │  │
│  │  ┌────────────┐  │  │                  │  │                      │  │
│  │  │ AI Preview │  │  │                  │  │                      │  │
│  │  │ Panel      │  │  │                  │  │                      │  │
│  │  │ - Stats    │  │  │                  │  │                      │  │
│  │  │ - Actions  │  │  │                  │  │                      │  │
│  │  └────────────┘  │  │                  │  │                      │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Backend API                                     │
│                                                                         │
│  POST /api/dwg/import/:importId/ai-smart-filter                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                 │   │
│  │  1. Load all groups from dwg_groups table                       │   │
│  │                           │                                     │   │
│  │                           ▼                                     │   │
│  │  2. Check cache (ai_smart_filter_cache)                        │   │
│  │     └─▶ If cached → return immediately                          │   │
│  │                           │                                     │   │
│  │                           ▼                                     │   │
│  │  3. Batch groups (150 per batch)                                │   │
│  │     └─▶ 2056 groups = 14 batches                                │   │
│  │                           │                                     │   │
│  │                           ▼                                     │   │
│  │  4. For each batch → GPT-4o Text API                            │   │
│  │     ┌─────────────────────────────────────────────────────┐     │   │
│  │     │  SYSTEM PROMPT:                                     │     │   │
│  │     │  - Multi-language retail terminology dictionary     │     │   │
│  │     │  - Layer pattern recognition rules                  │     │   │
│  │     │  - Classification categories + filter reasons       │     │   │
│  │     │                                                     │     │   │
│  │     │  USER PROMPT:                                       │     │   │
│  │     │  - group_id, layer, block_name, count, size        │     │   │
│  │     │                                                     │     │   │
│  │     │  RESPONSE:                                          │     │   │
│  │     │  - category: shelf|fridge|checkout|wall|...        │     │   │
│  │     │  - should_filter: true/false                        │     │   │
│  │     │  - filter_reason: annotation|backofhouse|...       │     │   │
│  │     │  - confidence: 0.0-1.0                              │     │   │
│  │     │  - translated_name: English translation             │     │   │
│  │     └─────────────────────────────────────────────────────┘     │   │
│  │                           │                                     │   │
│  │                           ▼                                     │   │
│  │  5. Aggregate results + compute stats                           │   │
│  │                           │                                     │   │
│  │                           ▼                                     │   │
│  │  6. Cache to ai_smart_filter_cache table                       │   │
│  │                           │                                     │   │
│  │                           ▼                                     │   │
│  │  7. Return JSON response                                        │   │
│  │                                                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  POST /api/dwg/import/:importId/apply-smart-filter                     │
│  └─▶ Marks fixture IDs as deleted in deleted_fixture_ids_json          │
│                                                                         │
│  POST /api/dwg/import/:importId/apply-ai-mappings                      │
│  └─▶ Creates dwg_mappings records with AI-recommended types            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Classification Categories

| Category | Description | Examples |
|----------|-------------|----------|
| `shelf` | Gondola shelves, displays, pallets | Palette T1, Cubo, Scaffale |
| `fridge` | Refrigerators, freezers, coolers | Frigorifero, Red Bull Cooler |
| `checkout` | POS terminals, cash registers | L&F modules, Cassa |
| `entrance` | Doors, EAS gates | Antenna Ingresso, Entrata |
| `wall` | Perimeter walls, partitions | Muro_*, _MM_MURI layer |
| `pillar` | Structural columns | Pilastro, _MM_PILASTRI layer |
| `service_counter` | Bakery, deli counters | Banco gastronomia |
| `custom` | Unclassifiable items | - |

## Filter Reasons (should_filter = true)

| Reason | Description | Examples |
|--------|-------------|----------|
| `annotation` | Text labels, title blocks | 0×0 size, _MM_CARTIGLIO |
| `emergency` | Exit symbols, fire markers | Simbolo US, _MM_EMERGENZA |
| `utility` | Manholes, electrical panels | Chiusino, _MM_QUADRI |
| `backofhouse` | Warehouse, office areas | _MM_RISERVA, _MM_ARREDO UFFICI |
| `signage` | Graphics, floor markings | _MM_GRAFICA, _MM_STRISCE |
| `accessory` | Tiny items < 0.3m | Badge readers, caps |

## Multi-Language Dictionary (Built into System Prompt)

### Italian
- `Muro/Muri` → Wall
- `Frigorifero/Frigo` → Fridge  
- `Cassa/Casse` → Checkout
- `Scaffale` → Shelf
- `Pilastro` → Pillar
- `Ingresso/Entrata` → Entrance
- `Magazzino/Riserva` → Warehouse (backofhouse)
- `Ufficio` → Office (backofhouse)
- `Emergenza` → Emergency (filter)

### German
- `Möbel` → Furniture
- `Großgeräte` → Large appliances
- `Regal` → Shelf
- `Kasse` → Checkout
- `Eingang/Ausgang` → Entrance/Exit

### English
- `L&F *` → Checkout (Landi & Farina modules)
- `Palette/Pallet` → Display shelf
- `Cube/Cubo` → Display shelf
- `Cooler` → Fridge

## Files

### Backend
- **`backend/routes/aiSmartFilter.js`** — Main endpoint + GPT-4o calls
- **`backend/database/schema.js`** — `ai_smart_filter_cache` table

### Frontend
- **`frontend/src/components/dwgImporter/GroupListPanel.tsx`**
  - `AI Quick Clean` button
  - `AI Preview Panel` with stats + apply buttons
  - `onApplyAiFilter` / `onApplyAiMappings` callbacks

- **`frontend/src/components/dwgImporter/DwgImporterPage.tsx`**
  - Wires up AI filter handlers to GroupListPanel

## API Response Structure

```typescript
interface AiSmartFilterResponse {
  analysis_summary: string;
  groups: Array<{
    group_id: string;
    category: 'shelf' | 'fridge' | 'checkout' | 'entrance' | 'wall' | 'pillar' | 'service_counter' | 'custom';
    should_filter: boolean;
    filter_reason: 'annotation' | 'emergency' | 'utility' | 'backofhouse' | 'signage' | 'accessory' | null;
    confidence: number;
    translated_name?: string;
    reasoning: string;
  }>;
  filter_stats: {
    total_groups: number;
    to_filter: number;
    to_keep: number;
    by_category: Record<string, number>;
    by_filter_reason: Record<string, number>;
  };
  cached: boolean;
  model: string;
  latencyMs: number;
}
```

## Usage Flow

1. User clicks **"AI Quick Clean"** button in GroupListPanel
2. Frontend calls `POST /api/dwg/import/:importId/ai-smart-filter`
3. Backend processes groups in batches via GPT-4o
4. Results shown in **AI Preview Panel** with:
   - Stats (groups to keep vs filter)
   - Category breakdown
   - Filter reason breakdown
5. User can click:
   - **"Remove X Groups"** → Deletes filtered groups
   - **"Auto-Map Types"** → Applies AI classifications as mappings
