// PostCSS plugin: the accent colour (libs/appearance/accent.js). Every accent blue in the CSS
// (macOS's #0a84ff / #007aff, opaque or see-through) becomes rgb(var(--accent-rgb) / a), so it
// follows Settings → Appearance → Accent Colour. Apple's hover blue (#0071e3) becomes a darker
// accent, the light link blues (#4da3ff, #6cb4ff) a lighter one. Runs after the light
// appearance plugin, so its light copies follow the accent too.
//
// Left alone: the accent swatches themselves and the blue sticky-card colour.

const SKIP_FILE = /styles[\\/]accent\.css$/;
const SKIP_RULE = /accent-(dot|multicolor|blue|purple|pink|red|orange|yellow|green|graphite)|data-color/;

const TOKEN = /rgba?\(\s*(10|0)\s*[, ]\s*(132|122)\s*[, ]\s*255\s*(?:[,/]\s*([\d.]+%?))?\s*\)|#(0a84ff|007aff|0071e3|4da3ff|6cb4ff)\b/gi;

function alphaOf(raw) {
  if (raw === undefined) return 1;
  return raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw);
}

/** `value` with its accent blues on the accent; null when it has none. */
export function accentValue(value) {
  let changed = false;
  const out = value.replace(TOKEN, (match, r, g, a, hex) => {
    // (10,122) or (0,132) aren't the system blue.
    if (!hex && !((r === '10' && g === '132') || (r === '0' && g === '122'))) return match;
    changed = true;
    const h = hex?.toLowerCase();
    if (h === '0071e3') return 'color-mix(in srgb, rgb(var(--accent-rgb)) 86%, black)';
    if (h === '4da3ff' || h === '6cb4ff') return 'color-mix(in srgb, rgb(var(--accent-rgb)) 72%, white)';
    const alpha = alphaOf(a);
    return alpha === 1 ? 'rgb(var(--accent-rgb))' : `rgb(var(--accent-rgb) / ${alpha})`;
  });
  return changed ? out : null;
}

export default function accentColors() {
  return {
    postcssPlugin: 'iweb-accent',
    Once(root) {
      const file = root.source?.input?.file || '';
      if (SKIP_FILE.test(file)) return;
      root.walkDecls((decl) => {
        const rule = decl.parent;
        if (rule?.type === 'rule' && SKIP_RULE.test(rule.selector)) return;
        // Inline SVG keeps its colours (a data: URL can't read CSS variables).
        if (/url\(\s*["']?data:/i.test(decl.value)) return;
        const next = accentValue(decl.value);
        if (next !== null) decl.value = next;
      });
    },
  };
}
accentColors.postcss = true;
