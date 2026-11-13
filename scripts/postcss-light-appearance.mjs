// PostCSS plugin: iWeb's Light appearance (libs/appearance/appearance.js), generated from the
// dark CSS. For each rule of the macOS "system" surfaces (windows, menus, Control Center,
// Spotlight, Settings, Notes, dialogs) it adds a copy under :root[data-appearance="light"]
// holding only the declarations whose neutral colours change:
//
//   text (color, fill, stroke…)     white → near-black, keeping its opacity
//   fills and borders               see-through white → see-through black; dark panels → light
//   shadows                         black shadows lighter; text shadows fade
//   inline SVG (data: URLs)         white strokes and fills → black
//
// Colours with a hue (the accent blue, red, green…) are left alone, and so is anything inside
// [data-force-dark] (Music, the sticky cards on the desktop). Hand-made touches that can't be
// derived this way live in styles/appearance-light.css.

// Both wrapped in :where(), so a light copy is exactly as specific as its dark rule and sits
// right after it: the cascade between rules (a state like .is-on over the base rule) is kept.
const LIGHT_ATTR = '[data-appearance="light"]';
const LIGHT = `:where(:root${LIGHT_ATTR})`;
const FORCE_DARK = ':where(:not([data-force-dark], [data-force-dark] *))';

// Which files are themed, and optionally which of their rules (by selector).
const SCOPES = [
  { file: /styles[\\/](mac-window|update|settings-[a-z]+|wallpaper-settings|notes-(workspace|sidebar|markdown|tasks)|markets|mac-controls|notification-center|mac-alert|atmosphere|frontier)\.css$/ },
  // The Dock's Add App dialog, not the Dock.
  { file: /Dock\.module\.css$/, include: /dialog/i },
  // The News app, not the News widget on the desktop.
  { file: /styles[\\/]news\.css$/, exclude: /news-widget/ },
  { file: /search[\\/]styles[\\/]search\.css$/ },
  // Control Center, but not the timer bubble beside the Dynamic Island.
  { file: /styles[\\/]controlcenter\.css$/, exclude: /timer-bubble|cc-bubble/ },
  // The menu bar's menus and the Settings pop-up menus, not the bar over the wallpaper.
  { file: /styles[\\/]menubar\.css$/, include: /mb-menu|settings-select|settings-row-hint/ },
  // Right-click and pop-up menus, and the Edit Widgets toolbar.
  { file: /styles[\\/]desktop\.css$/, include: /dt-menu|dt-toolbar|dt-btn/ },
  // The shared window and dialog styles in the big stylesheet.
  { file: /styles[\\/]style\.css$/, include: /settings|remove-bg-(window|content)|window-controls|link-input|add-bookmark|confirmation-dialog|dialog|notes-|md-editor/ },
];

const TEXT_PROPS = /^(color|fill|stroke|caret-color|-webkit-text-fill-color|text-decoration-color|accent-color)$/;
const SURFACE_PROPS = /^(background(-color|-image)?|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|column-rule(-color)?)$/;
const SHADOW_PROPS = /^(box-shadow|text-shadow|filter|-webkit-filter)$/;

const COLOR_RE = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)|#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(white|black)\b/gi;

function parse(m) {
  if (m[6]) return m[6].toLowerCase() === 'white' ? [255, 255, 255, 1] : [0, 0, 0, 1];
  if (m[5]) {
    let h = m[5];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return [+m[1], +m[2], +m[3], a];
}

const fmt = (r, g, b, a) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Math.round(a * 1000) / 1000})`;
const neutral = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) <= 28;
const lum = (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

// System colours used as text: their dark-mode shades are made to read on dark glass and are
// too pale on light glass, so text takes macOS's darker light-mode shade (yellow → amber).
const SYSTEM_TEXT = {
  'ffd60a': [156, 104, 0], // yellow → dark gold (a plain deeper yellow turns olive)
  'ffcc00': [156, 104, 0],
  'ff9f0a': [184, 88, 0], // orange
  '0a84ff': [0, 122, 255], // blue (the accent: postcss-accent.mjs puts it on --accent-rgb)
  '007aff': [0, 122, 255],
  '6cb4ff': [0, 122, 255], // light blue (links): the accent too
  'ff453a': [215, 0, 21], // red
  'ff6961': [215, 0, 21],
};
const hex = (r, g, b) => [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

// Any other bright colour used for text, icons or lines (a pale green status, an amber
// warning…) keeps its hue and gets dark enough to read on light glass, as macOS's light-mode
// system colours are deeper versions of the dark-mode ones.
function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function rgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
const READABLE = 0.36; // the brightest a coloured text may be (perceived), on light glass
function deepen(r, g, b) {
  if (lum(r, g, b) <= READABLE) return null;
  const [h, s] = hsl(r, g, b);
  let l = hsl(r, g, b)[2];
  let out = [r, g, b];
  while (l > 0.12 && lum(...out) > READABLE) {
    l -= 0.02;
    out = rgb((h + 360) % 360, Math.min(1, s), l);
  }
  return out;
}

/** The light-appearance colour for one colour in a property of `kind`; null to keep it. */
export function lightColor([r, g, b, a], kind) {
  if (a === 0) return null;
  if (!neutral(r, g, b)) {
    if (kind !== 'text' && kind !== 'stroke' && kind !== 'token') return null;
    const shade = SYSTEM_TEXT[hex(r, g, b)] || deepen(r, g, b);
    return shade ? fmt(...shade, a) : null;
  }
  // Raised controls (buttons, keys, chips, tabs): in Light, macOS draws them white, so a
  // see-through white fill becomes a brighter white rather than a grey tint.
  if (kind === 'raised') {
    if (lum(r, g, b) > 0.5) return a >= 0.85 ? null : fmt(255, 255, 255, Math.min(0.9, 0.42 + a * 2.4));
    kind = 'surface';
  }
  const light = lum(r, g, b) > 0.5;
  if (kind === 'text') {
    // Dark text on see-through glass needs more body than white text on dark glass: faint
    // secondary text (0.4–0.7) becomes 0.7–0.85, so it reads over a busy wallpaper.
    return light ? fmt(0, 0, 0, Math.min(0.88, 0.45 + a * 0.43)) : null;
  }
  if (kind === 'stroke') {
    // SVG lines and icon fills keep their weight: a faint chart gridline stays faint.
    return light ? fmt(0, 0, 0, Math.min(0.85, a * 0.85)) : null;
  }
  if (kind === 'surface') {
    if (light) return a >= 0.85 ? null : fmt(0, 0, 0, a * 0.55); // solid white chips stay
    const v = (r + g + b) / 3;
    if (v < 12 && a < 0.5) return null; // a dimming veil stays dark
    const l = 255 - v * 0.45;
    return fmt(l, l, Math.min(255, l + 2), a);
  }
  if (kind === 'shadow') {
    return light ? null : fmt(r, g, b, a * 0.55);
  }
  return null;
}

// A rule for a raised control, by its selector's last part: buttons, keys, chips, tabs and
// segments, but not tracks, wells and fields (which stay a darker tint).
const RAISED = /(btn|button|chip|key|pill|tab|segment|seg-|option|preset|toggle|swatch|badge-btn)(?![-\w]*(track|rail|well|field|input|search|bar\b|progress))/i;
export const isRaised = (selector) => selector.split(/,(?![^(]*\))/).some((part) => RAISED.test(part.trim().split(/[\s>+~]+/).pop()));

/** The value for the light appearance, or null when nothing in it changes. */
export function lightValue(prop, value, { raised = false } = {}) {
  const p = prop.toLowerCase();
  let kind = null;
  // Colour tokens (--mk-text-2, --wp-surface…): treated by what their name says they are.
  if (p.startsWith('--')) {
    if (/text|fg|ink|label|muted|title/.test(p)) kind = 'text';
    else if (/surface|bg|background|border|hairline|separator|fill|track|rule/.test(p)) kind = 'surface';
    // Other tokens (--mk-up, --mk-down…): only system colours change, to their light shades.
    else kind = 'token';
  } else if (p === 'stroke' || p === 'fill') kind = 'stroke';
  else if (TEXT_PROPS.test(p)) kind = 'text';
  else if (SURFACE_PROPS.test(p)) kind = raised && /^background/.test(p) ? 'raised' : 'surface';
  else if (SHADOW_PROPS.test(p)) kind = p === 'text-shadow' ? 'textShadow' : 'shadow';
  if (!kind) return null;
  if (kind === 'textShadow') return /none/.test(value) ? null : 'none';
  let changed = false;
  // Inline SVG: white strokes and fills turn black.
  let out = value.replace(/url\((["']?)data:image\/svg\+xml[^)]*\)/gi, (url) => {
    const next = url.replace(/(stroke|fill)=(['"]|%27|%22)(white|%23fff(?:fff)?|%23FFF(?:FFF)?)\2/g, (_, attr, q) => `${attr}=${q}black${q}`);
    if (next !== url) changed = true;
    return next;
  });
  // Colours outside url(...) only.
  out = out.replace(/url\([^)]*\)|rgba?\([^)]*\)|#[0-9a-f]{3,8}\b|\b(?:white|black)\b/gi, (token) => {
    if (/^url\(/i.test(token)) return token;
    COLOR_RE.lastIndex = 0;
    const m = COLOR_RE.exec(token);
    if (!m || m[0].length !== token.length) return token;
    const next = lightColor(parse(m), kind);
    if (next === null) return token;
    changed = true;
    return next;
  });
  return changed ? out : null;
}

/** `sel` under the light appearance, outside [data-force-dark]. */
export function lightSelector(sel) {
  return sel.split(/,(?![^(]*\))/).map((part) => {
    let s = part.trim();
    // Keep a trailing pseudo-element last: the :not() goes before it.
    const pe = s.match(/(::?(before|after|placeholder|selection|marker|-webkit-[a-z-]+|-moz-[a-z-]+|first-line|first-letter|backdrop))+$/i);
    const pseudo = pe ? pe[0] : '';
    if (pseudo) s = s.slice(0, -pseudo.length);
    const guarded = `${s}${FORCE_DARK}${pseudo}`;
    if (/^(:root|html)\b/.test(guarded)) return guarded.replace(/^(:root|html)/, `$1:where(${LIGHT_ATTR})`);
    return `${LIGHT} ${guarded}`;
  }).join(',\n');
}

export default function lightAppearance() {
  return {
    postcssPlugin: 'iweb-light-appearance',
    Once(root, { Rule }) {
      const file = root.source?.input?.file || '';
      const scope = SCOPES.find((s) => s.file.test(file));
      if (!scope) return;
      const rules = [];
      root.walkRules((rule) => {
        if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
        if (rule.selector.includes(LIGHT_ATTR)) return;
        if (scope.include && !scope.include.test(rule.selector)) return;
        if (scope.exclude && scope.exclude.test(rule.selector)) return;
        rules.push(rule);
      });
      for (const rule of rules) {
        const raised = isRaised(rule.selector);
        const decls = [];
        rule.each((node) => {
          if (node.type !== 'decl') return;
          const value = lightValue(node.prop, node.value, { raised });
          if (value !== null) decls.push(node.clone({ value }));
        });
        if (!decls.length) continue;
        const copy = new Rule({ selector: lightSelector(rule.selector) });
        decls.forEach((d) => copy.append(d));
        rule.after(copy);
      }
    },
  };
}
lightAppearance.postcss = true;
