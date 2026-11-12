import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createMeasure } from '../src/roomscan/ar/measure.js';

// measure.js draws its length labels on a canvas. There is no canvas outside
// a browser, and what gets painted on it is not what these tests are about,
// so a stand-in that accepts any drawing call is enough.
beforeAll(() => {
  const anyCall = new Proxy({}, { get: () => () => {}, set: () => true });
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => anyCall }),
  };
});

afterEach(() => vi.restoreAllMocks());

function setup(mode) {
  const groups = [];
  const changes = [];
  const measure = createMeasure(
    { add: (g) => groups.push(g) },
    { mode, onChange: (s) => changes.push(s) },
  );
  return { measure, drawn: () => groups[0].children.length, changes };
}

const CAM = [0.3, 0.2, -1];
const hit = (x, z, timeMs = 0) => ({ hit: [x, -1.2, z], cam: CAM, normalUp: 1, timeMs });

describe('pairs mode', () => {
  it('draws a line only once a pair is complete', () => {
    const { measure, drawn } = setup('pairs');
    expect(measure.prompt()).toBe('Tap the first point');
    expect(measure.addTap(hit(0, 0))).toBe(0);
    expect(drawn()).toBe(1);                      // one marker
    expect(measure.prompt()).toBe('Tap the other end');
    expect(measure.addTap(hit(2, 0))).toBe(1);
    expect(drawn()).toBe(4);                      // 2 markers, line, label
    measure.addTap(hit(5, 5));
    expect(drawn()).toBe(5);                      // third tap starts a new pair: marker only
    expect(measure.rows()).toHaveLength(1);
  });
});

describe('outline mode', () => {
  it('joins every tap to the one before it', () => {
    const { measure, drawn } = setup('outline');
    measure.addTap(hit(0, 0));
    measure.addTap(hit(0.6, 0));
    expect(measure.prompt()).toBe('Tap the next point');
    measure.addTap(hit(0.6, 0.6));                // the tap that pairs mode would leave hanging
    expect(measure.rows()).toHaveLength(2);
    expect(drawn()).toBe(3 + 2 + 2);              // markers, lines, labels
    measure.addTap(hit(0, 0.6));
    measure.addTap(hit(0, 0));
    expect(measure.rows().map((r) => +r.measuredM.toFixed(6))).toEqual([0.6, 0.6, 0.6, 0.6]);
  });

  it('tags the newest side and drops that tag on undo', () => {
    const { measure } = setup('outline');
    measure.addTap(hit(0, 0));
    measure.addTap(hit(0.6, 0));
    expect(measure.tagLast(0.6)).toBe(true);
    measure.addTap(hit(0.6, 0.62));
    measure.tagLast(0.6);
    expect(measure.rows().map((r) => r.trueM)).toEqual([0.6, 0.6]);
    measure.undo();
    expect(measure.rows().map((r) => r.trueM)).toEqual([0.6]);
    // re-adding a point must not resurrect the old tag
    measure.addTap(hit(0.6, 0.9));
    expect(measure.rows().map((r) => r.trueM)).toEqual([0.6, null]);
  });
});

describe('tagging and clearing', () => {
  it('refuses to tag when there is no line yet', () => {
    const { measure } = setup('pairs');
    expect(measure.tagLast(1)).toBe(false);
    measure.addTap(hit(0, 0));
    expect(measure.tagLast(1)).toBe(false);
  });

  it('clear removes everything drawn and every tag', () => {
    const { measure, drawn } = setup('pairs');
    measure.addTap(hit(0, 0));
    measure.addTap(hit(1, 0));
    measure.tagLast(1);
    measure.clear();
    expect(drawn()).toBe(0);
    expect(measure.tapCount()).toBe(0);
    expect(measure.state().trueM).toEqual({});
  });

  it('undo on nothing is harmless', () => {
    const { measure, changes } = setup('pairs');
    measure.undo();
    expect(changes).toHaveLength(0);
  });
});

describe('anchored positions', () => {
  it('stores the position at once but redraws only for a visible move', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { measure, changes } = setup('pairs');
    measure.addTap(hit(0, 0));
    measure.addTap(hit(0.6, 0));
    const before = changes.length;

    now += 5000;
    measure.setAnchored(1, [0.6005, -1.2, 0]);   // half a millimetre
    expect(changes).toHaveLength(before);
    expect(measure.state().taps[1].anchored).toEqual([0.6005, -1.2, 0]);

    measure.setAnchored(1, [0.63, -1.2, 0]);     // 3 cm
    expect(changes).toHaveLength(before + 1);
    expect(measure.rows()[0].measuredM).toBeCloseTo(0.63, 9);
    expect(measure.rows()[0].atTapM).toBeCloseTo(0.6, 9);
  });

  it('does not redraw again inside the throttle window, then catches up on flush', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { measure, changes } = setup('pairs');
    measure.addTap(hit(0, 0));
    measure.addTap(hit(0.6, 0));
    const before = changes.length;

    now += 50;                                    // 50 ms after the last redraw
    measure.setAnchored(0, [0.05, -1.2, 0]);
    expect(changes).toHaveLength(before);
    // the row already reflects it: only the drawing and the save are deferred
    expect(measure.rows()[0].measuredM).toBeCloseTo(0.55, 9);

    measure.flush();
    expect(changes).toHaveLength(before + 1);
  });

  it('ignores a position for a tap that no longer exists', () => {
    const { measure, changes } = setup('pairs');
    measure.addTap(hit(0, 0));
    measure.undo();
    const before = changes.length;
    measure.setAnchored(0, [1, 1, 1]);
    expect(changes).toHaveLength(before);
    expect(measure.tapCount()).toBe(0);
  });
});
