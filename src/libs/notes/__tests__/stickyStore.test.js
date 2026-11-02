import { beforeEach, describe, expect, it } from 'vitest';
import {
  STICKY_STORAGE_KEY,
  _resetStickies,
  getStickies,
  isOnDesktop,
  normalizeStickies,
  pinToDesktop,
  pruneStickies,
  raiseSticky,
  removeFromDesktop,
  updateSticky,
} from '../stickyStore';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

const POS = { ax: 'right', x: 40, ay: 'top', y: 120 };

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
  _resetStickies();
});

describe('sticky cards', () => {
  it('pins, moves and removes a card without touching its note', () => {
    pinToDesktop(7, POS);
    expect(isOnDesktop(7)).toBe(true);
    expect(getStickies().cards['7']).toEqual({ ...POS, expanded: false, hideDone: false, color: null, z: 0 });
    updateSticky(7, { ax: 'left', x: 16, expanded: true });
    expect(getStickies().cards['7']).toMatchObject({ ax: 'left', x: 16, ay: 'top', y: 120, expanded: true });
    // Saved, and read back after a reload.
    _resetStickies();
    expect(getStickies().cards['7']).toMatchObject({ ax: 'left', x: 16, expanded: true });
    removeFromDesktop(7);
    expect(isOnDesktop(7)).toBe(false);
    expect(localStorage.getItem(STICKY_STORAGE_KEY)).toBe(null);
  });

  it('keeps several cards in a stacking order and raises one to the front', () => {
    pinToDesktop(1, POS);
    pinToDesktop(2, POS);
    pinToDesktop(3, POS);
    expect([1, 2, 3].map((id) => getStickies().cards[id].z)).toEqual([0, 1, 2]);
    raiseSticky(1);
    expect([1, 2, 3].map((id) => getStickies().cards[id].z)).toEqual([2, 0, 1]);
  });

  it('keeps a chosen paper colour, glass otherwise', () => {
    pinToDesktop(1, POS);
    updateSticky(1, { color: 'pink' });
    _resetStickies();
    expect(getStickies().cards['1'].color).toBe('pink');
    updateSticky(1, { color: 'neon' });
    expect(getStickies().cards['1'].color).toBe(null);
  });

  it('drops cards whose note is gone', () => {
    pinToDesktop(1, POS);
    pinToDesktop(2, POS);
    pruneStickies([2, 9]);
    expect(Object.keys(getStickies().cards)).toEqual(['2']);
  });

  it('repairs damaged or older saved state', () => {
    expect(normalizeStickies(null)).toEqual({ version: 1, cards: {} });
    const fixed = normalizeStickies({ cards: { 4: { ax: 'nowhere', x: 'a', z: 50 }, 5: 'junk', 6: { ...POS, z: 9 } } });
    expect(fixed.cards['4']).toEqual({ ax: 'right', x: 24, ay: 'top', y: 200, expanded: false, hideDone: false, color: null, z: 1 });
    expect(fixed.cards['5']).toBeUndefined();
    expect(fixed.cards['6'].z).toBe(0);
    localStorage.setItem(STICKY_STORAGE_KEY, '{broken');
    _resetStickies();
    expect(getStickies().cards).toEqual({});
  });
});
