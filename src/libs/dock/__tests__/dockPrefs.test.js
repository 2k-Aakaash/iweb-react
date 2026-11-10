import { describe, expect, it } from 'vitest';
import {
  DOCK_FIT_MIN,
  DOCK_SIZE_MAX,
  DOCK_SIZE_MIN,
  fitIconSize,
  magnificationPx,
  normalizeDockSize,
  normalizeMagnification,
} from '../dockPrefs';

describe('Dock size', () => {
  it('keeps the size within range and whole', () => {
    expect(normalizeDockSize(60)).toBe(60);
    expect(normalizeDockSize('72.6')).toBe(73);
    expect(normalizeDockSize(5)).toBe(DOCK_SIZE_MIN);
    expect(normalizeDockSize(500)).toBe(DOCK_SIZE_MAX);
    expect(normalizeDockSize('big')).toBe(null);
    expect(normalizeDockSize(NaN)).toBe(null);
  });

  it('magnifies by a share of the chosen size (Medium at 60px reaches 90px, as before)', () => {
    expect(magnificationPx(60, 'medium')).toBe(30);
    expect(magnificationPx(60, 'off')).toBe(0);
    expect(magnificationPx(80, 'large')).toBe(64);
    expect(normalizeMagnification('small')).toBe('small');
    expect(normalizeMagnification('huge')).toBe(null);
  });

  it('keeps the chosen size while the apps fit', () => {
    // 10 icons at 60px: 10 + 2/3 padding + 0.28 divider = 10.95 units ≈ 657px, +90px of wave.
    expect(fitIconSize({ size: 60, count: 10, dividers: 1, available: 1408, magnification: 30 })).toBe(60);
  });

  it('shrinks every icon evenly when they would not fit, even while magnified', () => {
    const size = fitIconSize({ size: 60, count: 30, dividers: 1, available: 1334, magnification: 30 });
    expect(size).toBeLessThan(60);
    // The Dock, plus the wave, fits the space.
    expect(size * (30 + 2 / 3 + 0.28) + 90).toBeLessThanOrEqual(1334);
    expect(fitIconSize({ size: 60, count: 31, dividers: 1, available: 1334, magnification: 30 })).toBeLessThanOrEqual(size);
  });

  it('never shrinks below the minimum, and ignores nonsense', () => {
    expect(fitIconSize({ size: 60, count: 500, available: 800, magnification: 30 })).toBe(DOCK_FIT_MIN);
    expect(fitIconSize({ size: 60, count: 0, available: 800 })).toBe(60);
    expect(fitIconSize({ size: 60, count: 5, available: 0 })).toBe(60);
  });
});
