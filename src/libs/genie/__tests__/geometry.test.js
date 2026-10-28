import { describe, expect, it } from 'vitest';
import { applyMatrix, genieRows, phases, quadraticEaseInOut, rectToQuadMatrix } from '../geometry';

const win = { left: 300, right: 1100, top: 100, bottom: 660 };
const dock = { left: 680, right: 728, top: 840, bottom: 888 };

describe('phases', () => {
  it('eases the slide over the first 45% and translates from 25%', () => {
    expect(phases(0)).toEqual({ slide: 0, translate: 0 });
    expect(phases(0.225).slide).toBeCloseTo(0.5);
    expect(phases(0.1).slide).toBeLessThan(0.1 / 0.45); // eases in
    expect(phases(0.25).translate).toBe(0);
    expect(phases(0.45).slide).toBe(1);
    expect(phases(0.625).translate).toBeGreaterThan(0.4);
    expect(phases(0.625).translate).toBeLessThan(0.5); // slightly soft start
    expect(phases(1)).toEqual({ slide: 1, translate: 1 });
  });
});

describe('quadraticEaseInOut', () => {
  it('is symmetric with fixed ends', () => {
    expect(quadraticEaseInOut(0)).toBe(0);
    expect(quadraticEaseInOut(0.5)).toBe(0.5);
    expect(quadraticEaseInOut(1)).toBe(1);
    expect(quadraticEaseInOut(0.25) + quadraticEaseInOut(0.75)).toBeCloseTo(1);
  });
});

describe('genieRows', () => {
  it('is the untouched window at f = 0', () => {
    const rows = genieRows(win, dock, 0, 10);
    expect(rows).toHaveLength(11);
    expect(rows[0]).toEqual({ y: 100, left: 300, right: 1100 });
    expect(rows[10]).toEqual({ y: 660, left: 300, right: 1100 });
  });

  it('collapses exactly onto the target at f = 1', () => {
    const rows = genieRows(win, dock, 1, 10);
    expect(rows[0].y).toBeCloseTo(dock.top);
    expect(rows[10].y).toBeCloseTo(dock.bottom);
    for (const r of rows) {
      expect(r.left).toBeCloseTo(dock.left);
      expect(r.right).toBeCloseTo(dock.right);
    }
  });

  it('keeps the top edge fixed while the bottom narrows (slide phase)', () => {
    const rows = genieRows(win, dock, 0.2, 20);
    expect(rows[0]).toEqual({ y: 100, left: 300, right: 1100 });
    const bottom = rows[20];
    expect(bottom.y).toBe(660);
    expect(bottom.left).toBeGreaterThan(300);
    expect(bottom.right).toBeLessThan(1100);
    // Rows narrow monotonically down the funnel.
    for (let i = 1; i < rows.length; i++) expect(rows[i].right - rows[i].left).toBeLessThanOrEqual(rows[i - 1].right - rows[i - 1].left + 1e-9);
  });

  it('never lets the bottom edge pass the target bottom', () => {
    for (const f of [0.6, 0.8, 0.95]) {
      const rows = genieRows(win, dock, f, 12);
      expect(rows[12].y).toBeLessThanOrEqual(dock.bottom + 1e-9);
      expect(rows[0].y).toBeLessThanOrEqual(rows[12].y);
    }
  });

  it('mirrors for a target above the window', () => {
    const top = { left: 680, right: 728, top: 8, bottom: 56 };
    const below = { left: 300, right: 1100, top: 300, bottom: 860 };
    const rows = genieRows(below, top, 1, 8);
    expect(rows[0].y).toBeCloseTo(top.top);
    expect(rows[8].y).toBeCloseTo(top.bottom);
    expect(genieRows(below, top, 0, 8)[0]).toEqual({ y: 300, left: 300, right: 1100 });
  });
});

describe('rectToQuadMatrix', () => {
  const quad = [{ x: 100, y: 50 }, { x: 420, y: 60 }, { x: 380, y: 140 }, { x: 160, y: 130 }];

  it('maps the rectangle corners onto the quad', () => {
    const m = rectToQuadMatrix(800, 14, ...quad);
    const corners = [[0, 0], [800, 0], [800, 14], [0, 14]];
    corners.forEach(([x, y], i) => {
      const p = applyMatrix(m, x, y);
      expect(p.x).toBeCloseTo(quad[i].x, 6);
      expect(p.y).toBeCloseTo(quad[i].y, 6);
    });
  });

  it('is affine for a parallelogram', () => {
    const m = rectToQuadMatrix(100, 10, { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 60, y: 20 }, { x: 10, y: 20 });
    expect(m[3]).toBe(0);
    expect(m[7]).toBe(0);
  });

  it('rejects degenerate quads', () => {
    expect(rectToQuadMatrix(100, 10, { x: 0, y: 5 }, { x: 100, y: 5 }, { x: 100, y: 5 }, { x: 0, y: 5 })).toBeNull();
  });
});
