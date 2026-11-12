import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  rectRoom, buildRoom, validateRoom, wallLength, feetToMetres,
} from '../src/roomscan/room/room_json.js';

const sample = JSON.parse(
  readFileSync(new URL('../samples/room_rect_12x14ft.json', import.meta.url), 'utf8'),
);

const L_FLOOR = [[0, 0], [4, 0], [4, 2], [2.5, 2], [2.5, 3], [0, 3]];

function room(overrides = {}) {
  return { ...buildRoom({ source: 'manual', floor: L_FLOOR, height: 2.7 }), ...overrides };
}

function errorsOf(r) {
  const v = validateRoom(r);
  expect(v.ok).toBe(false);
  return v.errors.join(' | ');
}

describe('sample file', () => {
  it('is a valid room', () => {
    const v = validateRoom(sample);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('matches what the code builds for 12 x 14 ft', () => {
    // the sample is what teammates build against, so it must not drift from
    // what the manual form will actually emit
    const built = rectRoom(feetToMetres(12), feetToMetres(14), 2.7);
    built.floor.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(sample.floor[i][0], 9);
      expect(p[1]).toBeCloseTo(sample.floor[i][1], 9);
    });
    expect(Object.keys(built).sort()).toEqual(Object.keys(sample).sort());
    expect(Object.keys(built.quality).sort()).toEqual(Object.keys(sample.quality).sort());
  });
});

describe('wallLength', () => {
  it('follows the corner order, including the closing wall', () => {
    const r = room();
    expect(wallLength(r, 0)).toBeCloseTo(4, 12);
    expect(wallLength(r, 2)).toBeCloseTo(1.5, 12);
    expect(wallLength(r, 5)).toBeCloseTo(3, 12);
  });
});

describe('validateRoom accepts', () => {
  it('a concave room', () => {
    // an L-shape is not self-crossing; a careless check flags it as one
    expect(validateRoom(room()).ok).toBe(true);
  });

  it('an opening that exactly fills its wall', () => {
    const r = room({
      openings: [{ type: 'window', wall: 2, offset: 0, width: 1.5, sill: 0.9, height: 1.2 }],
    });
    expect(validateRoom(r).errors).toEqual([]);
  });
});

describe('validateRoom rejects', () => {
  it('fewer than three corners', () => {
    expect(errorsOf(room({ floor: [[0, 0], [3, 0]] }))).toMatch(/3 or more/);
  });

  it('a corner that is not a finite number', () => {
    expect(errorsOf(room({ floor: [[0, 0], [3, NaN], [3, 3]] }))).toMatch(/finite/);
  });

  it('a self-crossing outline', () => {
    const bowTie = [[0, 0], [4, 3], [4, 0], [0, 3]];
    expect(errorsOf(room({ floor: bowTie }))).toMatch(/cross/);
  });

  it('a repeated corner', () => {
    expect(errorsOf(room({ floor: [[0, 0], [3, 0], [3, 0], [3, 4]] }))).toMatch(/zero length/);
  });

  it('corners all on one line', () => {
    expect(errorsOf(room({ floor: [[0, 0], [2, 0], [5, 0]] }))).toMatch(/no area/);
  });

  it('a wrong version, unit or source', () => {
    const e = errorsOf(room({ version: 2, units: 'ft', source: 'guess' }));
    expect(e).toMatch(/version/);
    expect(e).toMatch(/units/);
    expect(e).toMatch(/source/);
  });

  it('a missing or non-positive height', () => {
    expect(errorsOf(room({ height: 0 }))).toMatch(/height/);
    expect(errorsOf(room({ height: undefined }))).toMatch(/height/);
  });

  it('an opening that runs past the end of its wall', () => {
    const r = room({
      openings: [{ type: 'door', wall: 2, offset: 0.8, width: 0.9, sill: 0, height: 2 }],
    });
    expect(errorsOf(r)).toMatch(/past the end of wall 2/);
  });

  it('an opening taller than the room', () => {
    const r = room({
      openings: [{ type: 'window', wall: 0, offset: 1, width: 1, sill: 1.8, height: 1.2 }],
    });
    expect(errorsOf(r)).toMatch(/taller than the room/);
  });

  it('an opening on a wall that does not exist', () => {
    const r = room({
      openings: [{ type: 'door', wall: 6, offset: 0, width: 0.9, sill: 0, height: 2 }],
    });
    expect(errorsOf(r)).toMatch(/wall index/);
  });

  it('an unknown opening type and bad numbers', () => {
    const r = room({
      openings: [{ type: 'arch', wall: 0, offset: -1, width: 0, sill: 0, height: 2 }],
    });
    const e = errorsOf(r);
    expect(e).toMatch(/type/);
    expect(e).toMatch(/offset is negative/);
    expect(e).toMatch(/width must be positive/);
  });

  it('something that is not a room at all', () => {
    expect(validateRoom(null).ok).toBe(false);
    expect(validateRoom('room').ok).toBe(false);
  });
});
