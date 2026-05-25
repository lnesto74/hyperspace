/**
 * Live checkout lane status — shared by Checkout Operations Center API
 * and Neural Dashboard queue alerts.
 */

import { DEFAULT_CHECKOUT_ALERT_CONFIG } from './CheckoutAlertConfig.js';

function dedupeByName(list) {
  const byName = new Map();
  for (const r of list) byName.set(r.name, r);
  return [...byName.values()];
}

function getCenter(roi) {
  try {
    const vertices = JSON.parse(roi.vertices || '[]');
    if (vertices.length === 0) return { x: 0, z: 0 };
    const sumX = vertices.reduce((s, v) => s + (v.x || 0), 0);
    const sumZ = vertices.reduce((s, v) => s + (v.z || 0), 0);
    return { x: sumX / vertices.length, z: sumZ / vertices.length };
  } catch {
    return { x: 0, z: 0 };
  }
}

export function getCheckoutLanes(db, trackAggregator, venueId) {
  const rois = db.prepare(
    'SELECT id, name, vertices FROM regions_of_interest WHERE venue_id = ?'
  ).all(venueId);

  const queueRois = dedupeByName(rois.filter(r => r.name && r.name.includes('- Queue')));
  const serviceRois = dedupeByName(rois.filter(r => r.name && r.name.includes('- Service')));

  const zoneSettingsRows = db.prepare(`
    SELECT r.name, zs.is_open
    FROM zone_settings zs
    JOIN regions_of_interest r ON r.id = zs.roi_id
    WHERE zs.venue_id = ?
  `).all(venueId);
  const openByName = new Map();
  for (const row of zoneSettingsRows) {
    openByName.set(row.name, row.is_open === 1);
  }

  const sortedQueueRois = queueRois
    .map(r => ({ ...r, center: getCenter(r) }))
    .sort((a, b) => a.center.x - b.center.x);

  const lanes = [];
  let totalQueueCount = 0;

  sortedQueueRois.forEach((queueRoi, index) => {
    const prefix = queueRoi.name.replace('- Queue', '').trim();
    const serviceRoi = serviceRois.find(s => s.name.replace('- Service', '').trim() === prefix);
    const queueCount = trackAggregator?.getZoneOccupancy?.(queueRoi.id) || 0;
    const isOpen = openByName.has(queueRoi.name) ? openByName.get(queueRoi.name) : true;

    if (isOpen) totalQueueCount += queueCount;

    const displayIndex = index + 1;
    lanes.push({
      laneId: displayIndex,
      queueZoneId: queueRoi.id,
      serviceZoneId: serviceRoi?.id ?? null,
      displayIndex,
      displayName: `Lane ${displayIndex}`,
      name: prefix,
      desiredState: isOpen ? 'open' : 'closed',
      status: isOpen ? 'OPEN' : 'CLOSED',
      queueCount: isOpen ? queueCount : 0,
      avgWaitTimeSec: null,
      occupancyRate: undefined,
      cashierAgentId: null,
    });
  });

  const openLaneCount = lanes.filter(l => l.status === 'OPEN').length;
  const closedLaneCount = lanes.filter(l => l.status === 'CLOSED').length;
  const avgQueuePerLane = openLaneCount > 0 ? totalQueueCount / openLaneCount : 0;
  const pressureThreshold = DEFAULT_CHECKOUT_ALERT_CONFIG.queuePressureThreshold;
  const closedLane = lanes.find(l => l.status === 'CLOSED');

  return {
    lanes,
    pressure: {
      totalQueueCount,
      openLaneCount,
      closedLaneCount,
      avgQueuePerLane: Math.round(avgQueuePerLane * 10) / 10,
      pressureThreshold,
      shouldOpenMore: avgQueuePerLane > pressureThreshold && closedLaneCount > 0,
      suggestedLaneToOpen: closedLane?.displayIndex || null,
      suggestedQueueZoneId: closedLane?.queueZoneId || null,
    },
  };
}
