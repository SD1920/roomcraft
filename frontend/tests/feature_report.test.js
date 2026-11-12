import { describe, it, expect } from 'vitest';
import { REQUIRED, OPTIONAL, featureRows, verdict } from '../src/roomscan/ar/feature_report.js';

describe('featureRows', () => {
  it('lists every feature once, required first', () => {
    const rows = featureRows([]);
    expect(rows.map((r) => r.name)).toEqual([...REQUIRED, ...OPTIONAL]);
    expect(rows[0].required).toBe(true);
  });

  it('explains the cost only for features that were not granted', () => {
    const rows = featureRows(['hit-test', 'dom-overlay']);
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by['hit-test'].granted).toBe(true);
    expect(by['hit-test'].note).toBe('');
    expect(by['camera-access'].granted).toBe(false);
    expect(by['camera-access'].note).not.toBe('');
  });

  it('does not claim yes or no when the browser reported nothing', () => {
    expect(featureRows(null).every((r) => r.granted === null)).toBe(true);
  });
});

describe('verdict', () => {
  it('is a no-go without hit-test, whatever else is granted', () => {
    expect(verdict(OPTIONAL)).toMatch(/^NO-GO/);
  });

  it('is a go with hit-test and names what is missing', () => {
    const v = verdict(['hit-test', 'dom-overlay']);
    expect(v).toMatch(/^GO/);
    expect(v).toMatch(/camera-access/);
    expect(v).not.toMatch(/dom-overlay/);
  });

  it('is a clean go when everything is granted', () => {
    expect(verdict([...REQUIRED, ...OPTIONAL])).toMatch(/every feature/);
  });

  it('makes no call when the browser reported nothing', () => {
    expect(verdict(null)).not.toMatch(/GO/);
  });
});
