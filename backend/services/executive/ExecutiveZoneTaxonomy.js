/**
 * Classify venue ROIs into Esselunga executive journey groups.
 * Reads ROI metadata, zone_settings.zone_type, and linked shelf/object categories.
 */

import { resolveShelfCategories } from '../ShelfCategoryResolver.js';

const FRESCO_PATTERNS = [
  'ortofrutta', 'macelleria', 'gastronomia', 'pescheria', 'panetteria', 'latticini',
  'fresco', 'fresh', 'deli', 'bakery', 'butcher', 'fish', 'piazza del fresco',
  'frutta e verdura', 'frutta', 'verdura', 'carne', 'pesce', 'pane', 'salumi',
];

const FRESCO_CATEGORY_MAP = {
  'frutta e verdura': 'ortofrutta',
  'frutta': 'ortofrutta',
  'verdura': 'ortofrutta',
  'ortofrutta': 'ortofrutta',
  'carne': 'macelleria',
  'macelleria': 'macelleria',
  'pesce': 'pescheria',
  'pescheria': 'pescheria',
  'pane': 'panetteria',
  'panetteria': 'panetteria',
  'salumi': 'gastronomia',
  'gastronomia': 'gastronomia',
  'latticini': 'latticini',
};

const CHECKOUT_CHANNEL_PATTERNS = {
  traditional: ['traditional', 'tradizionale', 'cassa trad', 'standard checkout'],
  selfCheckout: ['self-checkout', 'self checkout', 'self_checkout', 'sco', 'self-co'],
  selfScan: ['self-scan', 'self scan', 'scan-and-go', 'scan and go', 'self_scan'],
};

function norm(s) {
  return String(s || '').toLowerCase().trim();
}

function parseMeta(json) {
  try {
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}

function matchesAny(text, patterns) {
  const n = norm(text);
  return patterns.some(p => n.includes(p));
}

function resolveZoneType(meta, zoneSetting) {
  return zoneSetting?.zone_type || meta.zoneType || null;
}

function mapCategoryToFrescoDept(label) {
  const n = norm(label);
  for (const [key, dept] of Object.entries(FRESCO_CATEGORY_MAP)) {
    if (n.includes(key)) return dept;
  }
  return inferFrescoDept(n);
}

function isFrescoCategory(text, objectType) {
  if (objectType === 'banco') return true;
  return matchesAny(text, FRESCO_PATTERNS);
}

/**
 * @param {object} roi - { id, name, metadata_json }
 * @param {object|null} zoneSetting - { zone_type, linked_service_zone_id }
 * @param {{ categoryLabel?: string, objectType?: string|null }} linked
 */
export function classifyRoi(roi, zoneSetting = null, linked = {}) {
  const meta = parseMeta(roi.metadata_json);
  const name = norm(roi.name);
  const linkedCat = norm(linked.categoryLabel || '');
  const category = norm(
    meta.business_category || meta.business_category_label || linkedCat || '',
  );
  const section = norm(meta.executive_section || meta.zone_group || meta.journey_section || '');
  const checkoutChannel = norm(meta.checkout_channel || meta.checkoutChannel || '');
  const zoneType = resolveZoneType(meta, zoneSetting);
  const isCheckout = name.includes('checkout') || name.includes('cassa')
    || meta.template === 'cashier-queue';

  if (isCheckout) {
    const channel = resolveCheckoutChannel(checkoutChannel, name) || 'traditional';
    const role = zoneType === 'service' || name.includes('service') ? 'service' : 'queue';
    return { group: 'checkout', subGroup: channel, role };
  }

  if (
    section === 'fresco'
    || isFrescoCategory(category || name, linked.objectType)
    || isFrescoCategory(linkedCat, linked.objectType)
  ) {
    const dept = mapCategoryToFrescoDept(category || linkedCat || name);
    if (zoneType === 'queue' || name.includes('queue')) {
      return { group: 'fresco', subGroup: dept, role: 'queue' };
    }
    if (zoneType === 'service' || name.includes('service') || linked.objectType === 'banco') {
      return { group: 'fresco', subGroup: dept, role: 'service' };
    }
    return { group: 'fresco', subGroup: dept, role: 'browse' };
  }

  if (checkoutChannel) {
    const channel = resolveCheckoutChannel(checkoutChannel, name);
    if (channel) return { group: 'checkout', subGroup: channel, role: 'queue' };
  }

  if (zoneType === 'queue' && (name.includes('checkout') || name.includes('cassa'))) {
    return { group: 'checkout', subGroup: resolveCheckoutChannel('', name) || 'traditional', role: 'queue' };
  }

  if (zoneType === 'service' || (name.includes('service') && !isCheckout)) {
    return { group: 'service', subGroup: category || linkedCat || 'service', role: 'service' };
  }

  if (name.includes('traffic') || name.includes('entrance') || name.includes('ingress')) {
    return { group: 'ingress', subGroup: 'ingress', role: 'traffic' };
  }

  if (
    name.includes('engagement') || name.includes('shelf') || name.includes('category')
    || name.includes('scaffale') || name.includes('corsia') || name.includes('aisle')
    || meta.type === 'smart-kpi'
  ) {
    return {
      group: 'aisles',
      subGroup: category || linkedCat || meta.business_category_label || 'general',
      role: 'shelf',
    };
  }

  return { group: 'other', subGroup: category || linkedCat || 'other', role: 'general' };
}

function inferFrescoDept(text) {
  const n = norm(text);
  for (const p of FRESCO_PATTERNS) {
    if (n.includes(p) && p !== 'banco') return mapCategoryToFrescoDept(p);
  }
  if (n.includes('orto') || n.includes('frutta')) return 'ortofrutta';
  if (n.includes('macell') || n.includes('carne')) return 'macelleria';
  if (n.includes('gastronom') || n.includes('salum')) return 'gastronomia';
  if (n.includes('pes')) return 'pescheria';
  if (n.includes('pan')) return 'panetteria';
  return 'fresco';
}

function resolveCheckoutChannel(explicit, name) {
  const combined = norm(`${explicit} ${name}`);
  if (matchesAny(combined, CHECKOUT_CHANNEL_PATTERNS.selfScan)) return 'selfScan';
  if (matchesAny(combined, CHECKOUT_CHANNEL_PATTERNS.selfCheckout)) return 'selfCheckout';
  if (matchesAny(combined, CHECKOUT_CHANNEL_PATTERNS.traditional)) return 'traditional';
  if (combined.includes('checkout') || combined.includes('cassa') || combined.includes('queue')) {
    return 'traditional';
  }
  return null;
}

function resolveLinkedObject(db, meta) {
  const shelfId = meta.shelfId || meta.cashierId || null;
  if (!shelfId) return { categoryLabel: '', objectType: null };

  const resolved = resolveShelfCategories(db, shelfId);
  const label = resolved.categories[0]
    || resolved.business_category?.business_category_label
    || '';
  return { categoryLabel: label, objectType: resolved.objectType || null };
}

/**
 * Load all ROIs for a venue with zone_settings joined.
 */
export function loadClassifiedRois(db, venueId) {
  const rois = db.prepare(`
    SELECT r.id, r.name, r.metadata_json,
      zs.zone_type, zs.linked_service_zone_id
    FROM regions_of_interest r
    LEFT JOIN zone_settings zs ON zs.roi_id = r.id
    WHERE r.venue_id = ?
  `).all(venueId);

  return rois.map(roi => {
    const meta = parseMeta(roi.metadata_json);
    const linked = resolveLinkedObject(db, meta);
    return {
      ...roi,
      linkedCategory: linked.categoryLabel,
      classification: classifyRoi(roi, roi.zone_type ? roi : null, linked),
    };
  });
}

export function groupRoisBySection(classifiedRois) {
  const sections = {
    ingress: [],
    fresco: [],
    aisles: [],
    checkout: [],
    service: [],
    other: [],
  };
  for (const roi of classifiedRois) {
    const g = roi.classification.group;
    if (sections[g]) sections[g].push(roi);
    else sections.other.push(roi);
  }
  return sections;
}

export const CHECKOUT_CHANNEL_LABELS = {
  traditional: 'Traditional',
  selfCheckout: 'Self-checkout',
  selfScan: 'Self-scan',
};

export const FRESCO_DEPT_LABELS = {
  ortofrutta: 'Produce',
  macelleria: 'Butcher',
  gastronomia: 'Deli',
  pescheria: 'Fish',
  panetteria: 'Bakery',
  latticini: 'Dairy',
  fresco: 'Fresh',
};
