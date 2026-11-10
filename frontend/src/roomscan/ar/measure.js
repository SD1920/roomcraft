// Tap-to-measure: markers, the line for each segment, and its length label.
//
// State is two plain values -- the tap list and the true-length tags -- and
// the 3D objects are rebuilt from them after every change. With a few dozen
// taps at most that costs nothing, and it means Undo cannot leave a stray
// marker or label behind.

import * as THREE from 'three';
import {
  makeTap, segmentCount, segmentIndices, segmentRows, finalPosition,
} from './tap_log.js';

const MARKER = 0xffd23f;
const LINE = 0xffffff;

// Anchored points creep by fractions of a millimetre every frame. Redrawing
// and saving on each one would rebuild every label 60 times a second.
const ANCHOR_REDRAW_M = 0.002;
const ANCHOR_REDRAW_MS = 300;

function makeLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.beginPath();
  ctx.roundRect(4, 4, 248, 88, 20);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 46px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 50);
  const texture = new THREE.CanvasTexture(canvas);
  // depthTest off: the label must stay readable when the floor mesh or a
  // marker is in front of it
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }),
  );
  sprite.scale.set(0.24, 0.09, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function disposeGroup(group) {
  group.traverse((o) => {
    o.geometry?.dispose();
    o.material?.map?.dispose();
    o.material?.dispose();
  });
  group.clear();
}

/**
 * Always starts empty: taps from an earlier session live in that session's
 * frame and would be drawn in the wrong place in this one.
 * @param scene the AR scene to draw into
 * @param mode 'pairs' (0-1, 2-3 ...) or 'outline' (0-1, 1-2 ...)
 * @param onChange called with {taps, trueM} after every change
 */
export function createMeasure(scene, { mode = 'pairs', onChange } = {}) {
  let taps = [];
  let trueM = {};
  const group = new THREE.Group();
  scene.add(group);

  let drawn = [];        // positions as last drawn, to judge anchor movement
  let lastRedrawMs = 0;

  function rebuild() {
    disposeGroup(group);
    drawn = taps.map((t) => [...finalPosition(t)]);
    for (const p of drawn) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 16, 12),
        new THREE.MeshBasicMaterial({ color: MARKER }),
      );
      marker.position.fromArray(p);
      group.add(marker);
    }
    const rows = segmentRows(taps, trueM, mode);
    segmentIndices(taps.length, mode).forEach(([i, j], k) => {
      const a = new THREE.Vector3().fromArray(drawn[i]);
      const b = new THREE.Vector3().fromArray(drawn[j]);
      group.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({ color: LINE }),
      ));
      const label = makeLabel(`${(rows[k].measuredM * 100).toFixed(1)} cm`);
      label.position.copy(a).add(b).multiplyScalar(0.5);
      label.position.y += 0.06;
      group.add(label);
    });
    lastRedrawMs = performance.now();
  }

  function changed() {
    rebuild();
    onChange?.({ taps, trueM });
  }

  rebuild();

  return {
    /** @returns {number} index of the new tap */
    addTap(hit) {
      taps.push(makeTap({
        index: taps.length,
        timeMs: hit.timeMs,
        hit: hit.hit,
        cam: hit.cam,
        normalUp: hit.normalUp,
        reportedY: hit.reportedY,
      }));
      changed();
      return taps.length - 1;
    },
    /**
     * The phone's tracking has moved its estimate of where tap `index` is.
     * Stored at once; redrawn and saved only when it has moved visibly.
     */
    setAnchored(index, position) {
      const tap = taps[index];
      if (!tap) return;
      tap.anchored = position;
      const d = drawn[index];
      const moved = d
        ? Math.hypot(position[0] - d[0], position[1] - d[1], position[2] - d[2])
        : Infinity;
      if (moved > ANCHOR_REDRAW_M && performance.now() - lastRedrawMs > ANCHOR_REDRAW_MS) changed();
    },
    /** Redraw and save now. Called when the session ends. */
    flush() {
      changed();
    },
    undo() {
      if (taps.length === 0) return;
      taps.pop();
      // dropping a tap removes the last segment; its tag goes with it
      delete trueM[segmentCount(taps.length, mode)];
      changed();
    },
    clear() {
      taps = [];
      trueM = {};
      changed();
    },
    /** Tag the most recent segment with its tape-measure length. */
    tagLast(metres) {
      const n = segmentCount(taps.length, mode);
      if (n === 0) return false;
      trueM[n - 1] = metres;
      changed();
      return true;
    },
    rows: () => segmentRows(taps, trueM, mode),
    state: () => ({ taps, trueM }),
    tapCount: () => taps.length,
    /** What the user should do next, for the status line. */
    prompt() {
      if (taps.length === 0) return 'Tap the first point';
      if (mode === 'outline') return 'Tap the next point';
      return taps.length % 2 === 1 ? 'Tap the other end' : 'Tap the first end';
    },
  };
}
