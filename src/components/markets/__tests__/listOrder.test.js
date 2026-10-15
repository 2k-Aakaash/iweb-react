import { describe, expect, it } from 'vitest';
import { dropIndex, moveItem } from '../listOrder.js';

const LIST = ['A', 'B', 'C', 'D'];

describe('moveItem', () => {
  it('moves an item up or down without touching the original', () => {
    expect(moveItem(LIST, 0, 2)).toEqual(['B', 'C', 'A', 'D']);
    expect(moveItem(LIST, 3, 1)).toEqual(['A', 'D', 'B', 'C']);
    expect(LIST).toEqual(['A', 'B', 'C', 'D']);
  });

  it('clamps targets and ignores invalid sources', () => {
    expect(moveItem(LIST, 1, 99)).toEqual(['A', 'C', 'D', 'B']);
    expect(moveItem(LIST, 1, -5)).toEqual(['B', 'A', 'C', 'D']);
    expect(moveItem(LIST, 7, 0)).toEqual(LIST);
  });
});

describe('dropIndex', () => {
  it('drops before or after the hovered row', () => {
    const drop = (from, over, position) => moveItem(LIST, from, dropIndex(from, over, position));
    expect(drop(0, 2, 'after')).toEqual(['B', 'C', 'A', 'D']);
    expect(drop(3, 1, 'before')).toEqual(['A', 'D', 'B', 'C']);
    expect(drop(0, 3, 'after')).toEqual(['B', 'C', 'D', 'A']);
    expect(drop(3, 0, 'before')).toEqual(['D', 'A', 'B', 'C']);
  });

  it('is a no-op next to the dragged row', () => {
    expect(dropIndex(1, 2, 'before')).toBe(1);
    expect(dropIndex(1, 0, 'after')).toBe(1);
    expect(dropIndex(1, 1, 'after')).toBe(1);
  });
});
