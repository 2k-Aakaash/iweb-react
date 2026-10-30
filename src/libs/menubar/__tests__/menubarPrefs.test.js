import { describe, expect, it } from 'vitest';
import { desktopInsetFor, isMenubarHidden } from '../menubarPrefs';

describe('menu bar auto-hide', () => {
  it('hides as macOS 26 does for each setting', () => {
    const desktop = { appOpen: false, fullscreen: false };
    const inApp = { appOpen: true, fullscreen: false };
    const fullscreen = { appOpen: true, fullscreen: true };
    // On Desktop Only (the default): hidden with no app open.
    expect(isMenubarHidden('desktop', desktop)).toBe(true);
    expect(isMenubarHidden('desktop', inApp)).toBe(false);
    expect(isMenubarHidden('always', inApp)).toBe(true);
    expect(isMenubarHidden('fullscreen', inApp)).toBe(false);
    expect(isMenubarHidden('fullscreen', fullscreen)).toBe(true);
    expect(isMenubarHidden('never', fullscreen)).toBe(false);
  });

  it('takes room on the desktop only when it stays there', () => {
    expect(desktopInsetFor('desktop', { fullscreen: false })).toBe(0);
    expect(desktopInsetFor('always', { fullscreen: false })).toBe(0);
    expect(desktopInsetFor('never', { fullscreen: false })).toBe(32);
    expect(desktopInsetFor('fullscreen', { fullscreen: false })).toBe(32);
    expect(desktopInsetFor('fullscreen', { fullscreen: true })).toBe(0);
  });
});
