// Turn every detection from a scan into one list of suggested pieces.
//
// The same bed is seen in many frames, from different places, and each
// sighting lands on the floor a little differently (on the first phone run,
// one almirah's sightings spread over about 0.8 m). Sightings of the same
// type within MERGE_RADIUS_M of each other are one piece.
//
// Gemini's answer is preferred over the on-phone detector's: it knows the
// app's whole catalog, while the phone's model only knows a dozen furniture
// classes and calls an almirah a refrigerator. A phone sighting near a
// Gemini one of any type is dropped as already named.
//
// These are SUGGESTIONS. Nothing here becomes furniture until the user
// confirms it.

import { toRoom } from '../scan/room_frame.js';
import { catalogTypesFor } from './coco_catalog.js';

// Starting value: wider than the 0.8 m spread seen for one almirah, narrower
// than two pieces standing side by side usually are. Not tuned.
export const MERGE_RADIUS_M = 1.0;
// A sighting this far outside the walls was seen through a door, or placed
// badly, and is not in this room.
const OUTSIDE_TOLERANCE_M = 0.3;

/**
 * @param detections saved detection records: [{items: [{label, score, floor,
 *   source: 'phone' | 'gemini', types?}]}]
 * @param fit the room's fit; without one nothing can be placed
 * @param catalog map of type id -> catalog entry
 * @returns {{type, name, source, x, z, score, seen}[]} x, z in metres, room frame
 */
export function mergeDetections(detections, fit, catalog) {
  if (!fit?.ok) return [];
  const sightings = [];
  for (const d of detections ?? []) {
    for (const it of d.items ?? []) {
      if (!it.floor) continue;
      const source = it.source === 'gemini' ? 'gemini' : 'phone';
      const type = source === 'gemini' ? it.label : (it.types?.[0] ?? catalogTypesFor(it.label)[0]);
      if (!type || !catalog[type]) continue; // door, window, other, or not furniture
      const r = toRoom(fit, it.floor);
      if (Math.abs(r.x) > fit.widthM / 2 + OUTSIDE_TOLERANCE_M
          || Math.abs(r.z) > fit.lengthM / 2 + OUTSIDE_TOLERANCE_M) continue;
      sightings.push({ type, source, x: r.x, z: r.z, score: Number.isFinite(it.score) ? it.score : 0.5 });
    }
  }
  // Gemini first, then most confident first, so each piece is anchored on
  // its best sighting
  sightings.sort((a, b) => (a.source === b.source ? b.score - a.score : a.source === 'gemini' ? -1 : 1));

  const pieces = [];
  for (const s of sightings) {
    const same = pieces.find((p) => p.type === s.type && Math.hypot(p.x - s.x, p.z - s.z) < MERGE_RADIUS_M);
    if (same) {
      same.seen += 1;
      same.sumX += s.x;
      same.sumZ += s.z;
      same.x = same.sumX / same.seen;
      same.z = same.sumZ / same.seen;
      same.score = Math.max(same.score, s.score);
      continue;
    }
    if (s.source === 'phone' && pieces.some((p) => p.source === 'gemini'
        && Math.hypot(p.x - s.x, p.z - s.z) < MERGE_RADIUS_M)) continue;
    pieces.push({ type: s.type, source: s.source, x: s.x, z: s.z, sumX: s.x, sumZ: s.z, score: s.score, seen: 1 });
  }
  return pieces.map((p) => ({
    type: p.type, name: catalog[p.type].name, source: p.source, x: p.x, z: p.z, score: p.score, seen: p.seen,
  }));
}
