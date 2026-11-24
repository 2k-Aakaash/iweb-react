import { describe, expect, it } from 'vitest';
import { tokenCss } from '../engine.js';

describe('tokenCss', () => {
  it('writes the tokens and accent for Dark, and the Light values on their own', () => {
    const css = tokenCss('paper-ink', {
      tokens: { 'font-ui': '"Paper Serif", serif', 'radius-window': '6px' },
      light: { 'light-close': '#a33' },
      accent: '170 70 45',
      accentLight: null,
    });
    expect(css).toContain(':root[data-theme="paper-ink"][data-theme] {');
    expect(css).toContain('  --iw-font-ui: "Paper Serif", serif;');
    expect(css).toContain('  --iw-radius-window: 6px;');
    expect(css).toContain('  --accent-rgb: 170 70 45;');
    // Light gets its own block; the accent carries over when there's no Light accent.
    const light = css.slice(css.indexOf('[data-appearance="light"]'));
    expect(light).toContain('--iw-light-close: #a33;');
    expect(light).toContain('--accent-rgb: 170 70 45;');
  });

  it('outweighs the accent colours and Light rules of accent.css', () => {
    // accent.css's strongest rule: :root[data-appearance="light"][data-accent="purple"] (0,3,0).
    const css = tokenCss('x1', { tokens: {}, light: {}, accent: '1 2 3' });
    const light = /^(.*)\[data-appearance="light"\] \{/m.exec(css)[0];
    const attributes = light.match(/\[/g).length + 1; // + :root
    expect(attributes).toBeGreaterThan(3);
  });

  it('writes nothing for a theme without tokens', () => {
    expect(tokenCss('x1', { tokens: {}, light: {} })).toBe('');
  });
});
