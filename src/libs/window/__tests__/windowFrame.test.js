import { beforeEach, describe, expect, it } from 'vitest';
import { clampFrame, edgeAt, loadFrame, resizeFrame, saveFrame, snapZoneAt } from '../windowFrame';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
});

const RECT = { left: 100, top: 100, right: 700, bottom: 500 };

describe('window frames', () => {
  it('finds the edge or corner under the pointer', () => {
    expect(edgeAt(RECT, 400, 300)).toBe('');
    expect(edgeAt(RECT, 102, 300)).toBe('w');
    expect(edgeAt(RECT, 698, 498)).toBe('se');
    expect(edgeAt(RECT, 400, 101)).toBe('n');
    expect(edgeAt(RECT, 50, 300)).toBe(''); // outside
  });

  it('resizes from any edge, never below the minimum, keeping the far edge still', () => {
    const start = { left: 100, top: 100, width: 600, height: 400 };
    expect(resizeFrame(start, 'se', 50, 20)).toEqual({ left: 100, top: 100, width: 650, height: 420 });
    expect(resizeFrame(start, 'w', 40, 0)).toEqual({ left: 140, top: 100, width: 560, height: 400 });
    expect(resizeFrame(start, 'nw', 500, 500)).toEqual({ left: 320, top: 220, width: 380, height: 280 });
  });

  it('keeps a frame on screen with its title area reachable', () => {
    expect(clampFrame({ left: -2000, top: -50, width: 600, height: 400 }, 1440, 900, 32)).toEqual({ left: -520, top: 32, width: 600, height: 400 });
    expect(clampFrame({ left: 1430, top: 890, width: 3000, height: 3000 }, 1440, 900, 0)).toEqual({ left: 1360, top: 856, width: 1416, height: 888 });
  });

  it('snaps to the halves and to fill at the screen edges', () => {
    expect(snapZoneAt(1, 400, 1440, 32)).toBe('left');
    expect(snapZoneAt(1439, 400, 1440, 32)).toBe('right');
    expect(snapZoneAt(700, 33, 1440, 32)).toBe('fill');
    expect(snapZoneAt(700, 400, 1440, 32)).toBe(null);
  });

  it('remembers a frame per app', () => {
    saveFrame('notes', { left: 10, top: 40, width: 800, height: 500 });
    expect(loadFrame('notes')).toEqual({ left: 10, top: 40, width: 800, height: 500 });
    expect(loadFrame('music')).toBe(null);
    saveFrame('notes', null);
    expect(loadFrame('notes')).toBe(null);
  });
});
