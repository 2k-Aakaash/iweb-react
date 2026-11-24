// The iWeb theme package (docs/THEMES.md): a zip holding data only, never code.
//
//   theme.json   id, name, version, author, description, licence, minimum iWeb version,
//                appearance (dark | light | both), preview images, fonts
//   tokens.json  token values (styles/tokens.css), the accent, glass looks, icons, app names,
//                a wallpaper (all optional)
//   skin.css     extra styling (optional), checked by sanitizeCss.js
//   assets       fonts, images, sounds, anywhere in the package
//
// readThemePackage() unzips, checks everything against the rules below and returns a plain
// object; nothing from the package is trusted or run before that.
import { sanitizeCss } from './sanitizeCss.js';
import { cleanPath, extOf } from './paths.js';
import { SOUND_EVENTS } from './sounds.js';

export { cleanPath };

export const THEME_FORMAT = 1;
export const BUILT_IN_THEME = 'iweb'; // iWeb's own look: no package

export const LIMITS = Object.freeze({
  zipBytes: 25 * 1024 * 1024,
  totalBytes: 60 * 1024 * 1024, // unzipped
  fileBytes: 15 * 1024 * 1024,
  files: 300,
  jsonBytes: 256 * 1024,
  cssBytes: 512 * 1024,
});

// Files a theme may contain, by extension. Anything else (scripts, HTML…) rejects the package.
export const FILE_TYPES = Object.freeze({
  json: 'application/json',
  css: 'text/css',
  md: 'text/markdown',
  txt: 'text/plain',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
});
const IMAGE = new Set(['svg', 'png', 'jpg', 'jpeg', 'webp', 'avif', 'gif']);
const WALLPAPER = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif']);
const FONT = new Set(['woff2', 'woff', 'ttf', 'otf']);
const AUDIO = new Set(['ogg', 'mp3', 'wav']);
const SOUND_BYTES = 1024 * 1024; // interface sounds are short

// The tokens a theme may set (styles/tokens.css), without the --iw- prefix.
export const TOKENS = Object.freeze([
  'font-ui', 'font-medium', 'font-bold', 'font-rounded', 'font-heavy', 'font-system', 'font-mono',
  'radius-window', 'radius-window-compact', 'radius-dialog', 'radius-spotlight', 'radius-menu', 'radius-menu-item',
  'light-close', 'light-minimize', 'light-zoom',
  'ease', 'ease-standard', 'ease-out', 'ease-in', 'ease-spring', 'ease-spring-soft',
]);

// Glass surfaces (components/glass/glassPresets.js) and the numbers a theme may set on each.
export const GLASS_SURFACES = Object.freeze(['panel', 'window', 'spotlight', 'dock', 'bar', 'pill', 'label', 'card', 'tile']);
const GLASS_FIELDS = {
  blur: [0, 60], edgeBlur: [0, 2], bezel: [0, 60], refraction: [0, 6], chroma: [0, 0.1],
  lift: [-0.5, 0.5], saturate: [0, 3], specular: [0, 3],
};

// Apps a theme may rename (libs/theme/names.js).
export const NAMEABLE = Object.freeze(['apps', 'wallpaper', 'notes', 'music', 'settings', 'markets', 'news', 'atmosphere', 'frontier', 'spotlight', 'widgets', 'themes']);

export class ThemeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ThemeError';
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new ThemeError(code, message);
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function text(value, max, field) {
  if (typeof value !== 'string' || !value.trim()) fail('BAD_MANIFEST', `theme.json: "${field}" is missing.`);
  // Plain text only: no markup or control characters.
  const clean = value.replace(/[\u0000-\u001f<>]/g, '').trim(); // eslint-disable-line no-control-regex
  if (clean.length > max) fail('BAD_MANIFEST', `theme.json: "${field}" is longer than ${max} characters.`);
  return clean;
}

const optionalText = (value, max, field) => (value == null || value === '' ? '' : text(value, max, field));

/** [major, minor, patch] for "1.2.3" (or "1.2"), or null. */
export function parseVersion(v) {
  const m = /^v?(\d{1,4})\.(\d{1,4})(?:\.(\d{1,4}))?$/.exec(String(v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
}

/** > 0 when version a is newer than b. */
export function compareVersions(a, b) {
  const x = parseVersion(a) || [0, 0, 0];
  const y = parseVersion(b) || [0, 0, 0];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** Checks theme.json. `hasFile(path)` says whether the package holds a file. */
export function validateManifest(raw, hasFile = () => true, { iwebVersion = null } = {}) {
  if (!isObject(raw)) fail('BAD_MANIFEST', 'theme.json is not a JSON object.');
  if (raw.format !== THEME_FORMAT) fail('BAD_FORMAT', `This theme is for a different version of the theme format (${raw.format ?? 'none'}); iWeb reads format ${THEME_FORMAT}.`);
  const id = String(raw.id ?? '');
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(id)) fail('BAD_MANIFEST', 'theme.json: "id" must be 2–40 lowercase letters, digits or hyphens.');
  if (id === BUILT_IN_THEME) fail('BAD_MANIFEST', `theme.json: "${BUILT_IN_THEME}" is iWeb's own theme.`);
  if (!parseVersion(raw.version)) fail('BAD_MANIFEST', 'theme.json: "version" must look like 1.0.0.');
  const minIweb = raw.minIweb == null ? null : String(raw.minIweb);
  if (minIweb && !parseVersion(minIweb)) fail('BAD_MANIFEST', 'theme.json: "minIweb" must look like 3.2.');
  if (minIweb && iwebVersion && compareVersions(minIweb, iwebVersion) > 0) {
    fail('TOO_NEW', `This theme needs iWeb ${minIweb} or later. Update iWeb first.`);
  }
  const appearance = raw.appearance ?? 'both';
  if (!['dark', 'light', 'both'].includes(appearance)) fail('BAD_MANIFEST', 'theme.json: "appearance" must be "dark", "light" or "both".');

  const previews = (Array.isArray(raw.preview) ? raw.preview : raw.preview ? [raw.preview] : []).slice(0, 6).map((p) => {
    const path = cleanPath(p);
    if (!path || !IMAGE.has(extOf(path)) || !hasFile(path)) fail('MISSING_FILE', `theme.json: preview "${p}" isn't an image in the package.`);
    return path;
  });

  const fonts = (Array.isArray(raw.fonts) ? raw.fonts : []).slice(0, 12).map((f, i) => {
    if (!isObject(f)) fail('BAD_MANIFEST', `theme.json: fonts[${i}] is not an object.`);
    const family = text(f.family, 60, `fonts[${i}].family`);
    if (!/^[\w .-]+$/.test(family)) fail('BAD_MANIFEST', `theme.json: fonts[${i}].family may only use letters, digits, spaces, dots and hyphens.`);
    const src = cleanPath(f.src);
    if (!src || !FONT.has(extOf(src)) || !hasFile(src)) fail('MISSING_FILE', `theme.json: font "${f.src}" isn't a font file in the package.`);
    const weight = f.weight == null ? 'normal' : String(f.weight);
    if (!/^(normal|bold|[1-9]00( [1-9]00)?)$/.test(weight)) fail('BAD_MANIFEST', `theme.json: fonts[${i}].weight must be normal, bold or 100–900.`);
    const style = f.style == null ? 'normal' : String(f.style);
    if (!['normal', 'italic', 'oblique'].includes(style)) fail('BAD_MANIFEST', `theme.json: fonts[${i}].style must be normal or italic.`);
    return { family, src, weight, style };
  });

  return {
    format: THEME_FORMAT,
    id,
    name: text(raw.name, 40, 'name'),
    version: parseVersion(raw.version).join('.'),
    author: text(raw.author, 60, 'author'),
    description: optionalText(raw.description, 280, 'description'),
    license: optionalText(raw.license, 60, 'license'),
    homepage: /^https:\/\/[^\s"'<>]{1,200}$/.test(raw.homepage || '') ? raw.homepage : '',
    minIweb,
    appearance,
    previews,
    fonts,
  };
}

// A token value goes into a stylesheet as `--iw-x: value;`: it may not end the declaration or
// the rule, load anything, or run anything.
export function cleanTokenValue(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const v = String(value).trim();
  if (!v || v.length > 300) return null;
  if (!/^[\w\s#%.,()'"\-+/*!]+$/.test(v)) return null; // no ; { } < > \ : @
  if (/url\s*\(|image-set|expression|javascript/i.test(v)) return null;
  // Balanced brackets and quotes, so nothing can spill into the next declaration.
  let depth = 0;
  for (const ch of v) {
    if (ch === '(') depth++;
    if (ch === ')' && --depth < 0) return null;
  }
  if (depth || (v.split('"').length - 1) % 2 || (v.split("'").length - 1) % 2) return null;
  return v;
}

const rgbTriple = (v) => {
  const parts = String(v ?? '').trim().split(/[\s,]+/).map(Number);
  return parts.length === 3 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts.join(' ') : null;
};

function tokenBlock(raw, where) {
  if (raw == null) return {};
  if (!isObject(raw)) fail('BAD_TOKENS', `tokens.json: "${where}" must be an object.`);
  const out = {};
  for (const [name, value] of Object.entries(raw)) {
    const key = name.replace(/^--iw-/, '');
    if (!TOKENS.includes(key)) fail('BAD_TOKENS', `tokens.json: "${name}" isn't a token a theme can set.`);
    const clean = cleanTokenValue(value);
    if (clean == null) fail('BAD_TOKENS', `tokens.json: the value of "${name}" isn't allowed.`);
    out[key] = clean;
  }
  return out;
}

function glassBlock(raw, where) {
  if (raw == null) return {};
  if (!isObject(raw)) fail('BAD_TOKENS', `tokens.json: "${where}" must be an object.`);
  const out = {};
  for (const [surface, look] of Object.entries(raw)) {
    if (!GLASS_SURFACES.includes(surface)) fail('BAD_TOKENS', `tokens.json: "${where}.${surface}" isn't a glass surface.`);
    if (!isObject(look)) fail('BAD_TOKENS', `tokens.json: "${where}.${surface}" must be an object.`);
    const clean = {};
    for (const [field, value] of Object.entries(look)) {
      if (field === 'tint') {
        const ok = Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number' && Number.isFinite(n));
        if (!ok) fail('BAD_TOKENS', `tokens.json: "${where}.${surface}.tint" must be [r, g, b, alpha].`);
        clean.tint = [0, 1, 2].map((i) => Math.round(Math.min(255, Math.max(0, value[i])))).concat(Math.min(1, Math.max(0, value[3])));
      } else if (GLASS_FIELDS[field]) {
        if (typeof value !== 'number' || !Number.isFinite(value)) fail('BAD_TOKENS', `tokens.json: "${where}.${surface}.${field}" must be a number.`);
        const [lo, hi] = GLASS_FIELDS[field];
        clean[field] = Math.min(hi, Math.max(lo, value));
      } else {
        fail('BAD_TOKENS', `tokens.json: "${where}.${surface}.${field}" isn't a glass setting.`);
      }
    }
    out[surface] = clean;
  }
  return out;
}

/** Checks tokens.json. */
export function validateTokens(raw, hasFile = () => true) {
  if (raw == null) raw = {};
  if (!isObject(raw)) fail('BAD_TOKENS', 'tokens.json is not a JSON object.');
  const accent = raw.accent == null ? null : rgbTriple(raw.accent);
  if (raw.accent != null && !accent) fail('BAD_TOKENS', 'tokens.json: "accent" must be "R G B" (0–255 each).');
  const accentLight = raw.accentLight == null ? null : rgbTriple(raw.accentLight);
  if (raw.accentLight != null && !accentLight) fail('BAD_TOKENS', 'tokens.json: "accentLight" must be "R G B" (0–255 each).');

  const icons = {};
  if (raw.icons != null) {
    if (!isObject(raw.icons)) fail('BAD_TOKENS', 'tokens.json: "icons" must be an object.');
    for (const [key, file] of Object.entries(raw.icons)) {
      if (!/^[a-z][a-z0-9-]{1,40}$/.test(key)) fail('BAD_TOKENS', `tokens.json: "${key}" isn't an icon key.`);
      const path = cleanPath(file);
      if (!path || !IMAGE.has(extOf(path)) || !hasFile(path)) fail('MISSING_FILE', `tokens.json: icon "${file}" isn't an image in the package.`);
      icons[key] = path;
    }
  }

  const names = {};
  if (raw.names != null) {
    if (!isObject(raw.names)) fail('BAD_TOKENS', 'tokens.json: "names" must be an object.');
    for (const [key, name] of Object.entries(raw.names)) {
      if (!NAMEABLE.includes(key)) fail('BAD_TOKENS', `tokens.json: "${key}" isn't an app a theme can rename.`);
      names[key] = text(name, 24, `names.${key}`);
    }
  }

  const sounds = {};
  if (raw.sounds != null) {
    if (!isObject(raw.sounds)) fail('BAD_TOKENS', 'tokens.json: "sounds" must be an object.');
    for (const [event, file] of Object.entries(raw.sounds)) {
      if (!SOUND_EVENTS.includes(event)) fail('BAD_TOKENS', `tokens.json: "sounds.${event}" isn't a sound iWeb plays (${SOUND_EVENTS.join(', ')}).`);
      const path = cleanPath(file);
      if (!path || !AUDIO.has(extOf(path)) || !hasFile(path)) fail('MISSING_FILE', `tokens.json: sound "${file}" isn't an OGG, MP3 or WAV file in the package.`);
      sounds[event] = path;
    }
  }

  if (raw.glassEffect != null && !['on', 'off'].includes(raw.glassEffect)) {
    fail('BAD_TOKENS', 'tokens.json: "glassEffect" must be "on" or "off".');
  }

  let wallpaper = null;
  if (raw.wallpaper != null) {
    wallpaper = cleanPath(raw.wallpaper);
    if (!wallpaper || !WALLPAPER.has(extOf(wallpaper)) || !hasFile(wallpaper)) {
      fail('MISSING_FILE', `tokens.json: wallpaper "${raw.wallpaper}" isn't a PNG, JPEG, WebP or AVIF image in the package.`);
    }
  }

  return {
    tokens: tokenBlock(raw.tokens, 'tokens'),
    light: tokenBlock(raw.light, 'light'),
    accent,
    accentLight,
    glass: glassBlock(raw.glass, 'glass'),
    glassLight: glassBlock(raw.glassLight, 'glassLight'),
    icons,
    names,
    sounds,
    wallpaper,
    glassEffect: raw.glassEffect === 'off' ? 'off' : 'on',
  };
}

/**
 * Reads a theme zip. `JSZip` is passed in (loaded on demand). Returns
 * { manifest, tokens, css, removed, files: { path: { type, bytes } } } or throws a ThemeError.
 */
export async function readThemePackage(data, JSZip, { iwebVersion = null } = {}) {
  const size = data?.byteLength ?? data?.size ?? 0;
  if (size > LIMITS.zipBytes) fail('TOO_BIG', `The theme is larger than ${LIMITS.zipBytes / 1024 / 1024} MB.`);
  let zip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    fail('NOT_A_ZIP', "This file isn't a theme package (a .zip).");
  }

  let entries = Object.values(zip.files).filter((f) => !f.dir && !/(^|\/)(__MACOSX|\.DS_Store$|Thumbs\.db$)/.test(f.name));
  // A GitHub download wraps everything in one folder: read from inside it.
  if (!entries.some((f) => f.name === 'theme.json')) {
    const top = entries.find((f) => /^[^/]+\/theme\.json$/.test(f.name))?.name.split('/')[0];
    if (!top) fail('NO_MANIFEST', 'The package has no theme.json.');
    entries = entries.filter((f) => f.name.startsWith(`${top}/`)).map((f) => ({ file: f, name: f.name.slice(top.length + 1) }));
  } else {
    entries = entries.map((f) => ({ file: f, name: f.name }));
  }
  if (entries.length > LIMITS.files) fail('TOO_MANY_FILES', `The theme has more than ${LIMITS.files} files.`);

  const files = {};
  let total = 0;
  for (const { file, name } of entries) {
    const path = cleanPath(name);
    if (!path) fail('BAD_PATH', `The package has a file with an unsafe name ("${name}").`);
    const ext = extOf(path);
    if (!FILE_TYPES[ext]) fail('BAD_FILE_TYPE', `Themes can't contain .${ext || '(no extension)'} files ("${path}"). Themes are data only: no scripts or web pages.`);
    // The declared size first (a zip bomb is refused before it's inflated), then the real one.
    const declared = file._data?.uncompressedSize;
    if (declared > LIMITS.fileBytes) fail('TOO_BIG', `"${path}" is larger than ${LIMITS.fileBytes / 1024 / 1024} MB.`);
    const bytes = await file.async('uint8array');
    if (bytes.byteLength > LIMITS.fileBytes) fail('TOO_BIG', `"${path}" is larger than ${LIMITS.fileBytes / 1024 / 1024} MB.`);
    total += bytes.byteLength;
    if (total > LIMITS.totalBytes) fail('TOO_BIG', `The theme unpacks to more than ${LIMITS.totalBytes / 1024 / 1024} MB.`);
    files[path] = { type: FILE_TYPES[ext], bytes };
  }
  const hasFile = (path) => Object.hasOwn(files, path);

  const readJson = (path, required) => {
    if (!hasFile(path)) {
      if (required) fail('NO_MANIFEST', `The package has no ${path}.`);
      return null;
    }
    const bytes = files[path].bytes;
    if (bytes.byteLength > LIMITS.jsonBytes) fail('TOO_BIG', `${path} is too large.`);
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return fail('BAD_JSON', `${path} isn't valid JSON.`);
    }
  };

  const manifest = validateManifest(readJson('theme.json', true), hasFile, { iwebVersion });
  const tokens = validateTokens(readJson('tokens.json', false), hasFile);
  let css = '';
  let removed = [];
  if (hasFile('skin.css')) {
    const source = new TextDecoder().decode(files['skin.css'].bytes);
    if (source.length > LIMITS.cssBytes) fail('TOO_BIG', 'skin.css is larger than 512 KB.');
    ({ css, removed } = sanitizeCss(source, { hasFile }));
  }
  // Keep only what the theme uses (the manifest, tokens and CSS were read above).
  const used = new Set([...manifest.previews, ...manifest.fonts.map((f) => f.src), ...Object.values(tokens.icons)]);
  if (tokens.wallpaper) used.add(tokens.wallpaper);
  for (const path of Object.values(tokens.sounds)) {
    if (files[path].bytes.byteLength > SOUND_BYTES) fail('TOO_BIG', `The sound "${path}" is larger than 1 MB; interface sounds should be short.`);
    used.add(path);
  }
  for (const m of css.matchAll(/url\("iwtheme:([^"]+)"\)/g)) used.add(m[1]);
  const kept = {};
  for (const path of used) kept[path] = files[path];
  return { manifest, tokens, css, removed, files: kept };
}
