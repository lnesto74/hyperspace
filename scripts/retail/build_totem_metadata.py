"""Rebuild illustrative occlusion heights against the registered CAD indices.

Run from any directory. --check verifies the committed metadata without writing.
The output is not a survey: all heights are explicitly illustrative assumptions.
"""
import argparse
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'frontend/public/flowfield/retail'
HEIGHTS = {
    'meat': 1.45, 'beverages': 2.1, 'grocery': 2.1, 'deli': 1.45,
    'bakery': 2.1, 'table': .8, 'vegetables': 1.15, 'news': 1.7,
    'breakfast': 2.1, 'freezer': 1.25, 'checkout': 1.3, 'produce': 1.15,
    'dairy': 2.1, 'chilled': 2.1, 'fish': 1.45, 'freezer-wall': 2.1,
    'prepared': 1.45, 'self-checkout': 1.5, 'bar': 1.4, 'entrance': 2.1,
}

def build():
    manifest = json.loads((BASE / 'manifest.json').read_text())
    fixtures = {f['cadIndex']: f for f in manifest['fixtures']}
    config = json.loads((BASE / 'totem/config.json').read_text())
    displays = {d['cadIndex']: d for d in config['devices']}
    layout = json.loads((BASE.parent / 'layout_prod.json').read_text())
    with (ROOT / 'exports/treviglio_2026-08-11/02_shelves_fixtures.csv').open() as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == len(layout['polys']), 'CAD/source index count mismatch'
    result = []
    for index, row in enumerate(rows):
        if index in displays:
            d = displays[index]
            assert d['id'] == row['object_id'] and d['originalPolygon'] == layout['polys'][index]
            continue
        height = HEIGHTS.get(fixtures.get(index, {}).get('asset'), 1.15)
        if any(token in row['name'].upper() for token in ('PARET', 'WALL', 'PILAST', 'COLUMN')):
            height = 2.8
        result.append(dict(cadIndex=index, id=row['object_id'], name=row['name'],
                           height=height, heightBasis='illustrative collision proxy; not surveyed'))
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    result = build()
    path = BASE / 'totem/occluders.json'
    if args.check:
        assert json.loads(path.read_text()) == result, 'Occluder metadata differs from generator'
        print(f'PASS: {len(result)} reproducible CAD occluders; device identities preserved')
    else:
        path.write_text(json.dumps(result, separators=(',', ':')) + '\n')
        print(path)
