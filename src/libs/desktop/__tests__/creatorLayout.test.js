import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, ITEMS, addableItems, normalizeLayout, placementOf } from '../layout';

describe('Creator widgets in the layout', () => {
  it('start off the desktop and outside the Smart Stack', () => {
    const layout = normalizeLayout(DEFAULT_LAYOUT);
    expect(placementOf(layout, 'youtube')).toBe('hidden');
    expect(placementOf(layout, 'instagram')).toBe('hidden');
    expect(ITEMS.youtube.stackable).toBeFalsy();
    expect(layout.stack.pages).not.toContain('youtube');
  });

  it('keeps an arrangement saved before they existed', () => {
    const saved = {
      clock: { ax: 'center', x: 0, ay: 'middle', y: -40, size: 'large', hidden: false },
      quote: { ax: 'center', x: 0, ay: 'middle', y: 40, size: 'large', hidden: false },
      news: { ax: 'right', x: 16, ay: 'top', y: 182, size: 'large', hidden: false },
      stack: { ax: 'left', x: 16, ay: 'top', y: 16, size: 'medium', hidden: false, pages: ['weather', 'markets'] },
    };
    const layout = normalizeLayout(saved);
    expect(layout.clock).toMatchObject({ y: -40, size: 'large' });
    expect(layout.news).toMatchObject({ ax: 'right', size: 'large' });
    expect(layout.stack.pages).toEqual(['weather', 'markets']);
    expect(layout.youtube.hidden).toBe(true);
    // Added from the widget gallery, not offered in the desktop menu.
    expect(addableItems(layout)).not.toContain('youtube');
  });

  it('remember their size and position once placed', () => {
    const layout = normalizeLayout({ ...DEFAULT_LAYOUT, youtube: { ax: 'right', x: 182, ay: 'top', y: 348, size: 'large', hidden: false } });
    expect(layout.youtube).toEqual({ ax: 'right', x: 182, ay: 'top', y: 348, size: 'large', hidden: false });
    expect(normalizeLayout({ ...DEFAULT_LAYOUT, instagram: { ...DEFAULT_LAYOUT.instagram, size: 'huge' } }).instagram.size).toBe('medium');
  });

  it('never place Instagram Analytics while it is in development', () => {
    expect(ITEMS.instagram.inDevelopment).toBe(true);
    const layout = normalizeLayout({ ...DEFAULT_LAYOUT, instagram: { ...DEFAULT_LAYOUT.instagram, hidden: false } });
    expect(layout.instagram.hidden).toBe(true);
  });
});
