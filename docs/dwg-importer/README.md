# DWG → 3D Scene Importer

A feature for importing DWG/DXF floorplans into Hyperspace and automatically generating 3D scenes with mapped catalog assets.

## Overview

The DWG Importer allows you to:
1. Upload **DWG or DXF** floorplans directly
2. Automatically parse and group fixtures by block/layer/geometry
3. Map fixture groups to 3D catalog assets via UI
4. Generate 3D scenes with proper placement, rotation, and scaling

## Getting Started

### Enable the Feature

Add to `backend/.env`:
```
FEATURE_DWG_IMPORTER=true
```

### Install Dependencies

```bash
cd backend
npm install
```

### Enable DWG Support (Required for .dwg files)

DWG is a proprietary binary format. To enable direct DWG upload, install **LibreDWG**:

**macOS (Homebrew):**
```bash
brew install libredwg
```

**Ubuntu/Debian:**
```bash
sudo apt install libredwg-tools
```

**Fedora/RHEL:**
```bash
sudo dnf install libredwg-tools
```

**From source:**
```bash
git clone https://github.com/LibreDWG/libredwg.git
cd libredwg
./autogen.sh
./configure
make
sudo make install
```

**Alternative: ODA File Converter (free, cross-platform)**
1. Download from https://www.opendesign.com/guestfiles/oda_file_converter
2. Install to default location
3. The importer will auto-detect it

### Verify DWG Support

After installation, check the feature status:
```bash
curl http://localhost:3001/api/dwg/feature-status
```

Response should show `"dwg_supported": true`

### Access the Importer

Click the **FileUp** icon in the sidebar footer to open the DWG Importer.

## User Flow

1. **Upload** - Drag and drop a DXF file or click to browse
2. **Review Groups** - Fixtures are automatically grouped by similarity
3. **Map Assets** - Select a 3D catalog asset for each group
4. **Configure** - Adjust anchor point, offsets, and rotation
5. **Generate** - Create the 3D scene layout

## Supported DXF Entities

| Entity Type | Description |
|-------------|-------------|
| `INSERT` | Block references (best for fixtures) |
| `LWPOLYLINE` | Closed lightweight polylines |
| `POLYLINE` | Closed 3D polylines |

**Ignored entities:** TEXT, MTEXT, DIMENSION, HATCH, LINE, ARC, CIRCLE

## Coordinate System

- **DXF**: X/Y on floor plane, rotation around Z
- **Three.js**: X/Z on floor plane, Y is up, rotation around Y

Conversion:
```
x_scene = x_dxf * unit_scale_to_m
z_scene = y_dxf * unit_scale_to_m
y_scene = 0 (floor level)
rotY = -rot_deg * (π/180) + rotation_offset
```

## Mapping Configuration

Each group mapping includes:

| Field | Description |
|-------|-------------|
| `catalog_asset_id` | ID of the 3D model to use |
| `type` | Object type name |
| `anchor` | Placement anchor point |
| `offset_m` | Position offset in meters (x, y, z) |
| `rotation_offset_deg` | Additional rotation in degrees |

### Anchor Points

- `center` - Center of bounding box
- `back_center` - Back edge center
- `minx_miny` - Bottom-left corner
- `minx_maxy` - Top-left corner
- `maxx_miny` - Bottom-right corner
- `maxx_maxy` - Top-right corner

## API Endpoints

### Import DXF
```
POST /api/dwg/import
Content-Type: multipart/form-data

file: <DXF file>
venue_id: <optional venue ID>
```

### Get Import Details
```
GET /api/dwg/import/:import_id
```

### Save Mapping
```
PUT /api/dwg/import/:import_id/mapping
Content-Type: application/json

{
  "group_mappings": {
    "group_id_1": {
      "catalog_asset_id": "shelf",
      "type": "shelf",
      "anchor": "center",
      "offset_m": { "x": 0, "y": 0, "z": 0 },
      "rotation_offset_deg": 0
    }
  }
}
```

### Generate Layout
```
POST /api/dwg/import/:import_id/generate
Content-Type: application/json

{
  "venue_id": "<venue_id>",
  "name": "My Layout"
}
```

### Get Layout
```
GET /api/dwg/layout/:layout_version_id
```

### List Layouts
```
GET /api/dwg/layouts?venue_id=<venue_id>
```

### Get Catalog Assets
```
GET /api/dwg/catalog
```

### Check Feature Status
```
GET /api/dwg/feature-status
```

## Database Schema

### dwg_imports
Stores uploaded DXF files and parsed data.

### dwg_groups
Stores fixture groups extracted from imports.

### dwg_mappings
Stores group-to-asset mappings.

### dwg_layout_versions
Stores generated layout versions.

## Grouping Algorithm

Fixtures are grouped by:
1. **Block name** - INSERT entities with same block
2. **Layer + geometry signature** - Same layer and similar bounding box (25mm tolerance)

## Best Practices

### DXF Preparation
- Use consistent block names for fixture types
- Place fixtures on descriptive layers
- Ensure fixtures are closed polylines or INSERT blocks
- Remove unnecessary elements (text, dimensions, hatches)

### Mapping Tips
- Start with the largest groups first
- Use the preview to verify placement
- Adjust rotation offset if model orientation differs
- Use anchor points to align models correctly

## Troubleshooting

### No fixtures detected
- Ensure DXF contains INSERT or closed POLYLINE entities
- Check that polylines are actually closed
- Verify file is valid DXF format (not DWG)

### Wrong orientation
- Adjust `rotation_offset_deg` in mapping
- Common fixes: 0°, 90°, -90°, 180°

### Wrong position
- Adjust anchor point selection
- Fine-tune with `offset_m` values

### DWG files not supported
- Convert DWG to DXF using AutoCAD, LibreCAD, or online converter
- Save as DXF R12/R14 for best compatibility

## Example DXF

See `example_store.dxf` in this directory for a sample floorplan with:
- Shelf blocks on "SHELVES" layer
- Checkout counters on "CHECKOUT" layer
- Entrance markers on "ENTRANCE" layer
