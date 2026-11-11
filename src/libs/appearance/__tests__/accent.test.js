import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { normalizeAccent } from '../accent';
import accentColors, { accentValue } from '../../../../scripts/postcss-accent.mjs';

describe('accent colour', () => {
  it('knows the macOS accents', () => {
    expect(normalizeAccent('purple')).toBe('purple');
    expect(normalizeAccent('graphite')).toBe('graphite');
    expect(normalizeAccent('teal')).toBe(null);
  });

  it('puts the system blue, opaque or see-through, on the accent', () => {
    expect(accentValue('#0a84ff')).toBe('rgb(var(--accent-rgb))');
    expect(accentValue('1px solid #007AFF')).toBe('1px solid rgb(var(--accent-rgb))');
    expect(accentValue('0 0 0 3px rgba(10, 132, 255, 0.5)')).toBe('0 0 0 3px rgb(var(--accent-rgb) / 0.5)');
    expect(accentValue('rgba(0, 122, 255, 1)')).toBe('rgb(var(--accent-rgb))');
    expect(accentValue('#0071e3')).toBe('color-mix(in srgb, rgb(var(--accent-rgb)) 86%, black)');
  });

  it('leaves other colours alone', () => {
    expect(accentValue('#0a84fe')).toBe(null);
    expect(accentValue('rgba(10, 122, 255, 0.5)')).toBe(null);
    expect(accentValue('#ff453a')).toBe(null);
  });

  it('keeps the swatches, the sticky-card blue and inline SVG as they are', async () => {
    const css = '.a{color:#0a84ff}.accent-blue{background:#007aff}.stk[data-color="blue"]{--fill:#0a84ff}.b{background:url("data:image/svg+xml,%3Csvg fill=\'%230a84ff\'/%3E")}';
    const out = (await postcss([accentColors()]).process(css, { from: 'src/styles/x.css' })).css;
    expect(out).toContain('.a{color:rgb(var(--accent-rgb))}');
    expect(out).toContain('.accent-blue{background:#007aff}');
    expect(out).toContain('--fill:#0a84ff');
    expect(out).toContain("fill='%230a84ff'");
  });
});
