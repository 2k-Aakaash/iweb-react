import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { normalizeAppearance, resolveAppearance } from '../appearance';
import lightAppearance, { isRaised, lightSelector, lightValue } from '../../../../scripts/postcss-light-appearance.mjs';

describe('appearance setting', () => {
  it('resolves Auto from the system and keeps Light and Dark', () => {
    expect(resolveAppearance('auto', true)).toBe('dark');
    expect(resolveAppearance('auto', false)).toBe('light');
    expect(resolveAppearance('light', true)).toBe('light');
    expect(resolveAppearance('dark', false)).toBe('dark');
    expect(normalizeAppearance('auto')).toBe('auto');
    expect(normalizeAppearance('sepia')).toBe(null);
  });
});

describe('light appearance from the dark CSS', () => {
  it('turns white text dark, keeping its opacity', () => {
    expect(lightValue('color', '#fff')).toBe('rgba(0, 0, 0, 0.88)');
    expect(lightValue('color', 'rgba(255, 255, 255, 0.6)')).toBe('rgba(0, 0, 0, 0.708)'); // secondary text gets more body
    // System colours as text take macOS's darker light-mode shade; other colours stay.
    expect(lightValue('color', '#ffd60a')).toBe('rgba(156, 104, 0, 1)');
    expect(lightValue('color', '#0a84ff')).toBe('rgba(0, 122, 255, 1)');
    expect(lightValue('color', '#5b2c6f')).toBe(null); // already dark enough
    // Any other bright colour deepens in its own hue: a pale green status, an amber warning.
    expect(lightValue('color', '#5fe08a')).toBe('rgba(25, 131, 60, 1)');
    expect(lightValue('color', '#ffb300')).toBe('rgba(122, 86, 0, 1)');
    expect(lightValue('background', '#ffd60a')).toBe(null); // fills keep the bright shade
  });

  it('turns see-through white fills dark and dark panels light, but keeps veils and solid white', () => {
    expect(lightValue('background', 'rgba(255, 255, 255, 0.1)')).toBe('rgba(0, 0, 0, 0.055)');
    expect(lightValue('background', 'rgba(28, 28, 30, 0.6)')).toBe('rgba(242, 242, 244, 0.6)');
    expect(lightValue('background', 'rgba(0, 0, 0, 0.45)')).toBe(null);
    expect(lightValue('background', 'rgba(255, 255, 255, 0.96)')).toBe(null);
    expect(lightValue('border', '1px solid rgba(255, 255, 255, 0.12)')).toBe('1px solid rgba(0, 0, 0, 0.066)');
  });

  it('draws raised controls white, as macOS does, and keeps tracks and fields tinted', () => {
    expect(isRaised('.cc-calc-key')).toBe(true);
    expect(isRaised('.mk-range-btn.is-active, .x')).toBe(true);
    expect(isRaised('.cc-slider-track')).toBe(false);
    expect(isRaised('.notes-search-bar')).toBe(false);
    expect(lightValue('background', 'rgba(255, 255, 255, 0.1)', { raised: true })).toBe('rgba(255, 255, 255, 0.66)');
    expect(lightValue('background', 'rgba(255, 255, 255, 0.1)')).toBe('rgba(0, 0, 0, 0.055)');
    expect(lightValue('border', '1px solid rgba(255, 255, 255, 0.1)', { raised: true })).toBe('1px solid rgba(0, 0, 0, 0.055)');
  });

  it('lightens shadows, drops text shadows, and turns white SVG strokes black', () => {
    expect(lightValue('box-shadow', '0 4px 10px rgba(0, 0, 0, 0.4)')).toBe('0 4px 10px rgba(0, 0, 0, 0.22)');
    expect(lightValue('text-shadow', '0 1px 2px rgba(0,0,0,.3)')).toBe('none');
    expect(lightValue('background', "url(\"data:image/svg+xml,%3Csvg stroke='white'/%3E\") no-repeat"))
      .toBe("url(\"data:image/svg+xml,%3Csvg stroke='black'/%3E\") no-repeat");
  });

  it('reads colour tokens by their name', () => {
    expect(lightValue('--mk-text-2', 'rgba(255, 255, 255, 0.72)')).toBe('rgba(0, 0, 0, 0.76)');
    expect(lightValue('--mk-up', '#30d158')).toBe('rgba(28, 127, 53, 1)'); // system colours darken
    expect(lightValue('--mk-pill-up', '#1e7d36')).toBe(null);
    expect(lightValue('--wp-surface', 'rgba(255, 255, 255, 0.04)')).toBe('rgba(0, 0, 0, 0.022)');
    expect(lightValue('--mk-font', 'white')).toBe(null);
  });

  it('scopes copies to the light appearance, outside [data-force-dark], as specific as the original', () => {
    expect(lightSelector('.a .b::before, .c')).toBe(
      ':where(:root[data-appearance="light"]) .a .b:where(:not([data-force-dark], [data-force-dark] *))::before,\n'
      + ':where(:root[data-appearance="light"]) .c:where(:not([data-force-dark], [data-force-dark] *))',
    );
  });

  it('adds a light copy after each themed rule with only the changed declarations', async () => {
    const css = '.settings-x{color:#fff;padding:4px;background:#0a84ff}.other{color:#fff}';
    const out = await postcss([lightAppearance()]).process(css, { from: 'src/styles/style.css' });
    expect(out.css).toContain('.settings-x:where(:not([data-force-dark], [data-force-dark] *)){color:rgba(0, 0, 0, 0.88)}');
    expect(out.css).not.toContain('.other:where'); // not a window or dialog rule
    const untouched = await postcss([lightAppearance()]).process(css, { from: 'src/styles/desktop-clock.css' });
    expect(untouched.css).toBe(css);
  });
});
