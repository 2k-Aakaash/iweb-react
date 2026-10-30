import { describe, expect, it } from 'vitest';
import { coverRect, fillPlacement } from '../clockGlass';

describe('glass clock fill', () => {
  it('finds where the body draws the wallpaper (cover, centred)', () => {
    // A wide photo on a narrower screen: full height, cropped at the sides.
    expect(coverRect(2000, 1000, 1440, 900)).toEqual({ x: -180, y: 0, w: 1800, h: 900 });
    // A tall photo: full width, cropped at the top and bottom.
    expect(coverRect(1000, 2000, 1440, 900)).toEqual({ x: 0, y: -990, w: 1440, h: 2880 });
  });

  it('lines the fill up with the wallpaper behind the clock', () => {
    const cover = { x: -180, y: 0, w: 1800, h: 900 };
    const rect = { left: 500, top: 400, w: 400, h: 100 };
    // Unmagnified, the fill is the wallpaper shifted by the clock's place on screen.
    expect(fillPlacement(cover, rect, 1, 1)).toEqual({ size: [1800, 900], position: [-680, -400] });
    // Magnified around the clock's centre (700, 450): the point under the centre stays put.
    const { size, position } = fillPlacement(cover, rect, 1, 1.1);
    expect(size).toEqual([1980, 990]);
    const underCentre = (point, offset, scale) => (point - offset) / scale;
    expect(underCentre(200, position[0], 1.1)).toBeCloseTo(700 + 180, 6);
    expect(underCentre(50, position[1], 1.1)).toBeCloseTo(450, 6);
  });

  it('works in the clock’s own px while edit mode draws it smaller', () => {
    const cover = { x: 0, y: 0, w: 1440, h: 900 };
    const drawn = { left: 515, top: 403, w: 388, h: 97 }; // 400 × 100 at 0.97
    expect(fillPlacement(cover, drawn, 0.97, 1)).toEqual({ size: [1484.54, 927.84], position: [-530.93, -415.46] });
  });
});
