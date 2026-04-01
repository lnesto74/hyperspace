# TORINO 1 DWG Analysis Report

**File:** `TORINO 1 - LAY_03.c LAYOUT 02-03-26.dwg`  
**Import ID:** `127b4dfc-9c9f-4366-b1b9-d3a6d877c5ff`  
**Total Fixtures:** 2169  
**Total Groups:** 2056  
**Analysis Date:** 2026-03-27

---

## 1. Layer Breakdown (by fixture count)

| Layer | Groups | Fixtures | Description | **Retail Relevance** |
|-------|--------|----------|-------------|---------------------|
| `_MM_LAYOUT` | 986 | 986 | Main retail fixtures | ✅ **HIGH** - Shelves, displays, checkout modules |
| `Nuovo__MM_RISERVA` | 377 | 377 | Reserve/warehouse elements | ❌ LOW - Back-of-house |
| `_MM_MURI` | 159 | 159 | Walls | ✅ MEDIUM - Store boundary |
| `Nuovo__MM_MURI` | 71 | 71 | Additional walls | ✅ MEDIUM |
| `_MM_RISERVA` | 68 | 68 | Warehouse racks | ❌ LOW - Back-of-house |
| `Nuovo__MM_LAYOUT` | 68 | 68 | Additional layout items | ✅ **HIGH** |
| `_MM_LEGNO` | 66 | 66 | Wood elements | ⚠️ MEDIUM |
| `_MM_PILASTRI` | 48 | 48 | Pillars | ✅ MEDIUM - Obstacles |
| `Nuovo__MM_ARREDO UFFICI` | 48 | 48 | Office furniture | ❌ LOW - Back-of-house |
| `Nuovo__MM_ZONE REPARTI` | 28-33 | ~60 | Department zones | ✅ **HIGH** - ROI candidates |
| `Nuovo__MM_ZONE` | 28-34 | ~60 | Zones (WC, corridors, etc.) | ⚠️ MIXED |
| `_MM_EMERGENZA` | 17 | 17 | Emergency symbols | ❌ **FILTER OUT** |
| `_MM_CARTIGLIO` | 17 | 17 | Title blocks | ❌ **FILTER OUT** |
| `_MM_TAPPI` | 13 | 13 | Caps/plugs | ❌ **FILTER OUT** |
| `_MM_PLEXI` | 11 | 11 | Plexiglass barriers | ⚠️ MEDIUM |
| `_MM_ACCESSORI` | 8 | 8 | Accessories (manholes) | ❌ **FILTER OUT** |
| `_MM_INGRESSO` | 3-4 | ~4 | Entrance elements | ✅ **HIGH** |
| `_MM_QUADRI` | 2 | 2 | Electrical panels | ❌ **FILTER OUT** |
| `_MM_GRAFICA` | 1 | 1 | Graphics/signage | ❌ **FILTER OUT** |
| `_MM_STRISCE A TERRA` | 2 | 4 | Floor markings | ❌ **FILTER OUT** |

---

## 2. Multi-Language Block Names Detected

### 🇮🇹 Italian (Primary)
| Term | Translation | Classification |
|------|-------------|----------------|
| `Muro` | Wall | wall |
| `Frigorifero` | Refrigerator | fridge |
| `Cassa`, `Casse` | Cash register, Checkout | checkout |
| `Ingresso`, `Entrata` | Entrance | entrance |
| `Uscita` | Exit | entrance |
| `Scaffale` | Shelf | shelf |
| `Banco` | Counter | service_counter |
| `Scrivania` | Desk | custom (office) |
| `Tavolo` | Table | custom (office) |
| `Pilastro` | Pillar | pillar |
| `Protezione montante` | Rack protector | custom (warehouse) |
| `Chiusino in ghisa` | Cast iron manhole | **FILTER OUT** |
| `Simbolo US` | Emergency symbol | **FILTER OUT** |
| `Grande Elettrodomestico` | Large appliances | shelf (department) |
| `Piccolo Elettrodomestico` | Small appliances | shelf (department) |
| `Telefonia Mobile` | Mobile phones | shelf (department) |

### 🇩🇪 German
| Term | Translation | Classification |
|------|-------------|----------------|
| `Innovationsmöbel` | Innovation furniture | shelf/display |
| `Großgeräte` | Large appliances | shelf |
| `Möblierung-(furniture)` | Furniture | custom |

### 🇬🇧 English
| Term | Classification |
|------|----------------|
| `Smart Home` | shelf (department) |
| `Red Bull Open Front Cooler` | fridge |
| `L&F PC Module` | checkout |
| `L&F Dialog Module` | checkout |
| `L&F Cash Module` | checkout |
| `L&F Storage Module` | checkout |
| `L&F Working Place Module` | checkout |
| `Hardware Console` | shelf |
| `Personal Audio` | shelf |
| `HiFi` | shelf |
| `Software` | shelf |
| `Wearable` | shelf |

---

## 3. Key Retail Fixture Patterns

### Checkout System (L&F = Landi & Farina)
The DWG contains a sophisticated checkout system with modular components:
- `L&F PC Module` - Point of sale terminal
- `L&F Dialog Module` - Customer interaction screen
- `L&F Cash Module wo safe and receipt printer` - Cash drawer
- `L&F Working Place Module acrylic top` - Cashier workspace
- `L&F Storage Module with doors/drawers` - Storage
- `L&F Swing doors` - Checkout lane gates
- `Lettore Badge` - Badge reader
- `Elimina code` - Queue management

### Display Units
- `Palette T1/T3/T7/T9` - Different pallet sizes (0.4-1.2m × 0.8-1.3m)
- `Cubo 22` - Display cubes (various sizes up to 8.3m × 7m)
- `Frigorifero` - Refrigerators (0.65m × 0.65m)

### Department Zones (ZONE REPARTI)
Electronics store departments detected:
- `Smart Home`, `HiFi`, `Personal Audio`
- `Grande Elettrodomestico`, `Piccolo Elettrodomestico`
- `Telefonia Mobile`, `Tel.Fissa`
- `Hardware Console`, `Acc. Console`, `Hardware Computer`
- `Software`, `Acc. Computer`
- `Grandi Schermi` (Large screens)
- `Fotografia`, `Cuffie` (Headphones), `Wearable`
- `Incasso` (Built-in appliances)
- `Promo_Avancassa` (Pre-checkout promotions)

---

## 4. Recommended Filtering Rules

### ❌ AUTO-DELETE (Not relevant for people tracking)
```javascript
const AUTO_FILTER_LAYERS = [
  '_MM_EMERGENZA',      // Emergency symbols
  '_MM_CARTIGLIO',      // Title blocks/legends
  '_MM_ACCESSORI',      // Small accessories (manholes)
  '_MM_QUADRI',         // Electrical panels
  '_MM_GRAFICA',        // Graphics/signage
  '_MM_TAPPI',          // Caps/plugs
  '_MM_STRISCE A TERRA', // Floor markings
];

const AUTO_FILTER_BLOCKS = [
  /Simbolo US/i,        // Emergency symbols
  /chiusino/i,          // Manholes
  /Freccia passaggio/i, // Direction arrows
  /Lettore Badge/i,     // Badge readers (too small)
];
```

### ⚠️ BACK-OF-HOUSE (Filter if outside sales floor ROI)
```javascript
const BACKOFHOUSE_LAYERS = [
  'Nuovo__MM_RISERVA',  // Warehouse reserve
  '_MM_RISERVA',        // Warehouse
  'Nuovo__MM_ARREDO UFFICI', // Office furniture
  '_MM_ARREDO UFFICI',
];

const BACKOFHOUSE_ZONES = [
  /MAGAZZ/i,            // Warehouse
  /RISERVA/i,           // Reserve
  /SPOGL/i,             // Changing rooms
  /WC/i,                // Toilets
  /UFFICI/i,            // Offices
  /DIRETTORE/i,         // Director's office
  /RISTORO/i,           // Break room
  /LOC.TECNICO/i,       // Technical room
  /CED/i,               // Data center
  /CAV. TECN/i,         // Technical cabinet
];
```

### ✅ HIGH-VALUE (Always keep)
```javascript
const HIGH_VALUE_BLOCKS = [
  /L&F/i,               // Checkout modules
  /Cass[ae]/i,          // Checkout
  /Palette/i,           // Display pallets
  /Frigorifero/i,       // Fridges
  /Cubo/i,              // Display cubes
  /Ingresso|Entrata/i,  // Entrance
  /Antenna Ingresso/i,  // EAS gates
];

const HIGH_VALUE_LAYERS = [
  '_MM_LAYOUT',
  'Nuovo__MM_LAYOUT',
  '_MM_INGRESSO',
  'Nuovo__MM_INGRESSO',
];
```

---

## 5. Zero-Size Elements (Text Labels)

23 groups have size 0×0 - these are **text labels/annotations**, not physical fixtures:
- `AREA VENDITA`, `CORR.COMUNE`, `MAGAZZ.`, `WC U.`, `WC D.`
- `SPOGL.DONNE`, `SPOGL.UOMINI`, `DIRETTORE`, `RISTORO`
- `LOC.TECNICO`, `CED`, `CAV. TECN.`, etc.

**Recommendation:** Auto-filter groups with `size_w = 0 OR size_d = 0`

---

## 6. Proposed AI Classification Enhancements

### A. Multi-Language Dictionary
Add a translation layer before classification:
```javascript
const MULTILANG_DICT = {
  // Italian → English
  'muro': 'wall', 'frigorifero': 'fridge', 'cassa': 'checkout',
  'scaffale': 'shelf', 'banco': 'counter', 'ingresso': 'entrance',
  'uscita': 'exit', 'pilastro': 'pillar', 'grande elettrodomestico': 'large_appliance',
  // German → English
  'möbel': 'furniture', 'großgeräte': 'large_appliance',
  // etc.
};
```

### B. Layer-Based Pre-Classification
```javascript
const LAYER_CLASSIFICATIONS = {
  '_MM_MURI': 'wall',
  '_MM_PILASTRI': 'pillar',
  '_MM_INGRESSO': 'entrance',
  '_MM_LAYOUT': 'shelf',  // default, refine by block
  '_MM_RISERVA': 'custom', // warehouse
  '_MM_EMERGENZA': null,   // filter out
};
```

### C. Block Name Pattern Matching
```javascript
const BLOCK_PATTERNS = [
  { pattern: /^L&F/i, type: 'checkout', confidence: 0.95 },
  { pattern: /Cass[ae]/i, type: 'checkout', confidence: 0.90 },
  { pattern: /Frigorifero|Cooler|Frigo/i, type: 'fridge', confidence: 0.90 },
  { pattern: /Muro_\d+/i, type: 'wall', confidence: 0.95 },
  { pattern: /Pilastro/i, type: 'pillar', confidence: 0.95 },
  { pattern: /Palette|Cubo/i, type: 'shelf', confidence: 0.85 },
  { pattern: /Antenna.*Ingresso/i, type: 'entrance', confidence: 0.90 },
  { pattern: /Protezione montante/i, type: 'custom', filter: true },
];
```

---

## 7. Summary Statistics

| Metric | Count | % of Total |
|--------|-------|------------|
| **Total Groups** | 2056 | 100% |
| **High-Value Retail** | ~1100 | 53% |
| **Walls/Pillars** | ~260 | 13% |
| **Back-of-House** | ~500 | 24% |
| **Should Filter Out** | ~70 | 3% |
| **Zero-Size Labels** | 23 | 1% |
| **Ambiguous** | ~100 | 5% |

---

## 8. Next Steps

1. **Implement pre-filter** based on layer + zero-size rules
2. **Add multi-language dictionary** for block name normalization
3. **Enhance AI prompt** with Italian/German retail terminology
4. **Add "Sales Floor ROI" detection** to auto-exclude back-of-house
5. **Create "Quick Clean" button** to apply all filter rules at once
