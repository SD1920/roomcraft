// What the room scan draws in AR: a marker per wall tap, coloured by wall,
// then the fitted room outline on the floor and each door or window as a
// rectangle on its wall. Seeing the outline sit on the real walls is the
// quickest check a scan has worked.
//
// Rebuilt from the scan's plain data on every change, like ar/measure.js, so
// Undo can never leave a stray object behind.

import * as THREE from 'three';
import { fromRoom, wallLine } from './room_scan.js';
import { facingOf } from './furniture.js';

import { finalPosition } from '../ar/tap_log.js';

const WALL_COLOURS = [0xffd23f, 0x4fc3f7, 0xef5350, 0x81c784];
const OUTLINE = 0xffffff;
const OPENING = 0x00e5ff;
const FURNITURE = 0xff4fd8;
const DETECTED = 0xff9800;

/** Footprint of a floor piece, closed, a few mm above the floor. */
function footprint(fit, item) {
  const c = Math.cos(item.rotation), s = Math.sin(item.rotation);
  const hw = item.width / 2, hd = item.depth / 2;
  // three.js rotation about y: local (lx, lz) -> (lx c + lz s, -lx s + lz c)
  const at = (lx, lz) => fromRoom(fit, item.x + lx * c + lz * s, item.z - lx * s + lz * c, 0.005);
  return [at(-hw, -hd), at(hw, -hd), at(hw, hd), at(-hw, hd), at(-hw, -hd)];
}

function disposeGroup(group) {
  group.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  group.clear();
}

function marker(group, position, colour, radius = 0.012) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 16, 12),
    new THREE.MeshBasicMaterial({ color: colour }),
  );
  m.position.fromArray(position);
  group.add(m);
}

function polyline(group, points, colour) {
  group.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p))),
    new THREE.LineBasicMaterial({ color: colour }),
  ));
}

/** Corners of an opening in the AR frame, from its room-frame description. */
function openingCorners(fit, o) {
  const halfW = fit.widthM / 2, halfL = fit.lengthM / 2;
  const a = o.position - o.width / 2, b = o.position + o.width / 2;
  const lo = o.offset, hi = o.offset + o.height;
  const at = (along, y) => {
    switch (o.wall) {
      case 'front': return fromRoom(fit, along, -halfL, y);
      case 'back': return fromRoom(fit, along, halfL, y);
      case 'left': return fromRoom(fit, -halfW, along, y);
      default: return fromRoom(fit, halfW, along, y);
    }
  };
  return [at(a, lo), at(b, lo), at(b, hi), at(a, hi), at(a, lo)];
}

/**
 * @param catalog map of type id -> catalog entry, to know which way pieces face
 */
export function createRoomScanView(scene, catalog = null) {
  const group = new THREE.Group();
  scene.add(group);
  const detections = new THREE.Group(); // kept apart: replaced on each Detect
  scene.add(detections);

  return {
    /** Mark where each detected object stands on the floor. */
    showDetections(points) {
      disposeGroup(detections);
      for (const p of points) {
        marker(detections, p, DETECTED, 0.04);
        // a short post, so a marker on a busy floor is easy to spot
        polyline(detections, [p, [p[0], p[1] + 0.4, p[2]]], DETECTED);
      }
    },

    /** @param scan the object from createRoomScan() */
    update(scan) {
      disposeGroup(group);
      const taps = scan.saved().taps;
      for (const t of taps) {
        const colour = Number.isInteger(t.wall) ? WALL_COLOURS[t.wall % WALL_COLOURS.length] : FURNITURE;
        marker(group, finalPosition(t), colour);
      }
      // Each wall's line as soon as it has two taps, before the room is
      // known: the user sees straight away whether the line runs along the
      // real wall, instead of waiting for all four.
      for (let w = 0; w < WALL_COLOURS.length; w++) {
        const own = taps.filter((t) => t.wall === w);
        const fitted = wallLine(own.map((t) => (t.surfaceNormal ? { p: finalPosition(t), n: t.surfaceNormal } : finalPosition(t))));
        if (!fitted) continue;
        const { line } = fitted;
        const pts = own.map(finalPosition);
        const along = pts.map((p) => (p[0] - line.point[0]) * line.dir[0] + (p[2] - line.point[1]) * line.dir[1]);
        // a line from one surface tap has no length of its own: show a metre
        const a = Math.min(...along) - (pts.length > 1 ? 0.3 : 0.5), b = Math.max(...along) + (pts.length > 1 ? 0.3 : 0.5);
        // drawn at floor height when there are floor taps, else at the tap
        const floorPts = own.filter((t) => !t.surfaceNormal).map(finalPosition);
        const ys = (floorPts.length ? floorPts : pts).map((p) => p[1]);
        const y = ys.reduce((s, v) => s + v, 0) / ys.length + 0.005;
        const at = (s) => [line.point[0] + line.dir[0] * s, y, line.point[1] + line.dir[1] * s];
        polyline(group, [at(a), at(b)], WALL_COLOURS[w]);
      }
      const { fit, openings, furniture } = scan.result();
      if (fit.ok) {
        const halfW = fit.widthM / 2, halfL = fit.lengthM / 2;
        // a few mm above the floor so it is not hidden in the floor's noise
        const lift = 0.005;
        polyline(group, [
          fromRoom(fit, -halfW, -halfL, lift), fromRoom(fit, halfW, -halfL, lift),
          fromRoom(fit, halfW, halfL, lift), fromRoom(fit, -halfW, halfL, lift),
          fromRoom(fit, -halfW, -halfL, lift),
        ], OUTLINE);
        for (const o of openings) {
          if (o.opening) polyline(group, openingCorners(fit, o.opening), OPENING);
        }
        for (const f of furniture) {
          const item = f.item;
          if (!item) continue;
          if (item.wallMounted) {
            polyline(group, openingCorners(fit, { ...item, offset: item.elevation }), FURNITURE);
            continue;
          }
          polyline(group, footprint(fit, item), FURNITURE);
          // a short line from the centre out of the front, so a piece turned
          // the wrong way is obvious at a glance
          const entry = catalog?.[item.type];
          if (entry) {
            const [fx, fz] = facingOf(entry, item.rotation);
            const reach = item.depth / 2 + 0.25;
            polyline(group, [
              fromRoom(fit, item.x, item.z, 0.005),
              fromRoom(fit, item.x + fx * reach, item.z + fz * reach, 0.005),
            ], FURNITURE);
          }
        }
      }
      for (const p of scan.pendingPoints()) marker(group, p, FURNITURE, 0.02);
    },
  };
}
