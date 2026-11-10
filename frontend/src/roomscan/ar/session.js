// The AR session: camera tracking, the hit-test against real surfaces, the
// reticle that shows where a tap would land, and an anchor for every tap.
//
// Everything here is in the session's own frame: metres, y up, origin wherever
// the phone was when AR started. That origin is different every session and
// the floor is NOT at height zero in it -- nothing may assume otherwise.

import * as THREE from 'three';
import { createCameraFrameReader } from './camera_frame.js';
import { estimateFloorHeight } from './tap_log.js';

// A hit counts as floor when its surface normal is within this angle of
// straight up. 15 degrees is a starting value, not a measured one: every tap
// logs its tilt so the tolerance can be tightened from real data.
export const FLOOR_MAX_TILT_DEG = 15;
const FLOOR_MIN_UP = Math.cos((FLOOR_MAX_TILT_DEG * Math.PI) / 180);

// Shortest gap between two deliberate taps. The quickest real pair in the
// first phone run was 3.9 s apart, so this leaves a wide margin.
const DOUBLE_TAP_MS = 800;

const GREEN = 0x35c46a;
const GREY = 0x9a9a9a;
// a wall surface: usable in the room scan to place a wall hidden behind furniture
const BLUE = 0x3b82f6;
const WALL_MAX_NORMAL_Y = Math.sin((20 * Math.PI) / 180);

function makeReticle() {
  const group = new THREE.Group();
  // built flat in the XZ plane: the hit pose's Y axis is the surface normal
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.035, 0.045, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: GREEN }),
  );
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.006, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: GREEN }),
  );
  group.add(ring, dot);
  group.matrixAutoUpdate = false;
  group.visible = false;
  group.userData.setColor = (hex) => {
    ring.material.color.setHex(hex);
    dot.material.color.setHex(hex);
  };
  return group;
}

/**
 * Starts an AR session. Must be called from a click handler.
 *
 * @param overlayRoot DOM element shown on top of the camera view
 * @param onHit called every frame with (hit, ray): the current hit, or null when the
 *   centre of the screen is not on any detected surface
 * @param onTap called on every tap with { floorHit, ray }: floorHit is the
 *   current hit if it is level floor, else null; ray is { origin, dir }
 *   through the centre of the screen. Returns false to reject the tap, true
 *   to accept it, or a number to accept it and anchor it under that index
 *   (only possible when there was a floor hit)
 * @param onAnchorMove called with (tapIndex, [x, y, z]) whenever the phone's
 *   tracking updates where an already-tapped point is
 * @param onEnd called once when the session finishes for any reason
 * @returns {Promise<{scene: THREE.Scene, end: () => Promise<void>,
 *   forgetAnchorsFrom: (n: number) => void, enabledFeatures: string[] | null}>}
 */
export async function startSession({ overlayRoot, onHit, onTap, onAnchorMove, onEnd }) {
  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'],
    // camera-access: frames for the furniture detector (the phone grants it)
    optionalFeatures: ['dom-overlay', 'anchors', 'camera-access'],
    domOverlay: { root: overlayRoot },
  });

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8888aa, 3));
  const reticle = makeReticle();
  scene.add(reticle);

  let hitTestSource;
  try {
    await renderer.xr.setSession(session);
    // the hit-test ray leaves the phone along its viewing direction, i.e.
    // through the centre of the screen
    const viewerSpace = await session.requestReferenceSpace('viewer');
    hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
  } catch (e) {
    // the camera is already open at this point; leaving it open with no way
    // to close it is worse than the original failure
    renderer.dispose();
    await session.end().catch(() => {});
    throw e;
  }

  const startMs = performance.now();
  // heights of level hits seen while the user moves, to find the real floor
  // among beds, desks and boxes (see estimateFloorHeight)
  const levelHeights = [];
  const MAX_LEVEL_SAMPLES = 1500;
  let floorEstimate = null;
  let framesSinceEstimate = 0;
  let current = null;
  let tapRequested = false;
  let lastTapMs = -Infinity;
  const captureWaiters = [];  // promises waiting for the next camera frame
  let frameReader = null;     // made on first use

  // ---- anchors ------------------------------------------------------------
  // The phone keeps correcting its map of the room, and a point stored as
  // fixed coordinates stays where the OLD map put it: on screen the marker
  // slides off the spot that was tapped. An anchor is the phone's own handle
  // on that physical spot and moves with the corrections.
  //
  // Second phone run: two of four corners, tapped twice each, came back 4.2
  // and 5.8 cm apart. Anchors are the standard remedy; whether they help HERE
  // is read from the log, which keeps both the at-tap and anchored positions.
  const anchors = new Map(); // XRAnchor -> tap index
  const tokens = [];         // tokens[i] identifies the tap currently at index i

  function anchorTap(hitResult, index) {
    if (typeof index !== 'number' || typeof hitResult.createAnchor !== 'function') return;
    const token = Symbol('tap');
    tokens[index] = token;
    hitResult.createAnchor().then((anchor) => {
      // the tap may have been undone, and its index reused, while this waited
      if (tokens[index] === token) anchors.set(anchor, index);
      else anchor.delete?.();
    }).catch(() => {
      // no anchor for this tap: it keeps the position recorded at the tap
    });
  }

  function forgetAnchorsFrom(n) {
    tokens.length = Math.min(tokens.length, n);
    for (const [anchor, index] of anchors) {
      if (index >= n) {
        anchor.delete?.();
        anchors.delete(anchor);
      }
    }
  }

  renderer.setAnimationLoop((_time, frame) => {
    if (!frame) return;
    const refSpace = renderer.xr.getReferenceSpace();
    const viewer = frame.getViewerPose(refSpace);
    const hits = frame.getHitTestResults(hitTestSource);
    current = null;
    if (viewer && hits.length > 0) {
      const pose = hits[0].getPose(refSpace);
      if (pose) {
        const m = pose.transform.matrix;
        const p = pose.transform.position;
        const c = viewer.transform.position;
        current = {
          hit: [p.x, p.y, p.z],
          cam: [c.x, c.y, c.z],
          // column 1 of the pose matrix is its Y axis, the surface normal
          normalUp: m[5],
          // the full surface normal, so a tap on a wall can place that wall
          normal: [m[4], m[5], m[6]],
          isFloor: m[5] >= FLOOR_MIN_UP,
          isWall: Math.abs(m[5]) < WALL_MAX_NORMAL_Y,
          floorEstimate,
          timeMs: performance.now() - startMs,
        };
        reticle.matrix.fromArray(m);
        reticle.userData.setColor(current.isFloor ? GREEN : current.isWall ? BLUE : GREY);
      }
    }
    reticle.visible = current !== null;

    if (current && current.isFloor) {
      levelHeights.push(current.hit[1]);
      if (levelHeights.length > MAX_LEVEL_SAMPLES) levelHeights.shift();
    }
    // re-estimated a few times a second; sorting 1500 numbers every frame
    // would be wasted work
    if (++framesSinceEstimate >= 15) {
      framesSinceEstimate = 0;
      floorEstimate = estimateFloorHeight(levelHeights);
    }

    // The phone looks along its own -z axis: column 2 of the pose matrix,
    // negated. This is the ray through the centre of the screen, used to aim
    // at door and window corners, which are on walls and not on the floor.
    let ray = null;
    if (viewer) {
      const v = viewer.transform.matrix;
      const o = viewer.transform.position;
      ray = { origin: [o.x, o.y, o.z], dir: [-v[8], -v[9], -v[10]] };
    }

    // A tap is recorded here, not in the tap event: an anchor can only be
    // made from a hit result belonging to the frame being processed.
    if (tapRequested) {
      tapRequested = false;
      // a tap on a wall or a tilted surface is never passed on as a floor
      // point; the grey reticle is the user's warning
      const floorHit = current && current.isFloor ? current : null;
      const accepted = ray ? onTap({ floorHit, ray, hit: current }) : false;
      if (accepted !== false && accepted !== undefined && accepted !== null) {
        lastTapMs = performance.now() - startMs;
        if (typeof accepted === 'number' && current) anchorTap(hits[0], accepted);
      }
    }

    if (anchors.size > 0 && frame.trackedAnchors) {
      for (const [anchor, index] of anchors) {
        if (!frame.trackedAnchors.has(anchor)) continue;
        const pose = frame.getPose(anchor.anchorSpace, refSpace);
        if (pose) {
          const q = pose.transform.position;
          onAnchorMove?.(index, [q.x, q.y, q.z]);
        }
      }
    }

    onHit(current, ray);
    renderer.render(scene, camera);

    // A camera frame can only be read inside the frame that produced it.
    if (captureWaiters.length > 0 && viewer) {
      const waiters = captureWaiters.splice(0);
      try {
        frameReader ??= createCameraFrameReader(renderer.getContext(), session);
        const grabbed = { ...frameReader.read(viewer.views[0]), timeMs: performance.now() - startMs };
        waiters.forEach((w) => w.resolve(grabbed));
      } catch (e) {
        waiters.forEach((w) => w.reject(e));
      } finally {
        // the copy changed WebGL state that three.js keeps its own record of
        renderer.resetState();
      }
    }
  });

  session.addEventListener('select', () => {
    // First phone run: two taps 0.4 s and 1.2 cm apart were logged as a pair,
    // which also shifted the pairing of every tap after them. Nobody aims at a
    // new point that fast, so a second tap inside the window is a double tap.
    if (performance.now() - startMs - lastTapMs < DOUBLE_TAP_MS) return;
    tapRequested = true;
  });

  session.addEventListener('end', () => {
    captureWaiters.splice(0).forEach((w) => w.reject(new Error('The AR session ended.')));
    renderer.setAnimationLoop(null);
    try {
      hitTestSource.cancel();
    } catch {
      // the source dies with the session on some browsers
    }
    renderer.dispose();
    onEnd();
  });

  return {
    scene,
    end: () => session.end(),
    forgetAnchorsFrom,
    /** The floor height found so far, or null until enough level hits agree. */
    floorEstimate: () => floorEstimate,
    /**
     * The camera image of the next frame, with that view's projection and
     * pose. Rejects if the phone does not give camera frames.
     */
    captureFrame: () => new Promise((resolve, reject) => captureWaiters.push({ resolve, reject })),
    enabledFeatures: session.enabledFeatures ? Array.from(session.enabledFeatures) : null,
  };
}
