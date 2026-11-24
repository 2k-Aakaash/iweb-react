// Themes in use (docs/THEMES.md). The active theme is a stored setting (backed up, synced
// across tabs, readable on the first frame); its package lives in iWebDB (themeStore.js).
//
// Applying a theme, all from data:
//   <html data-theme="<id>">, the tokens and accent as a stylesheet, the checked skin.css with
//   its package files as blob: URLs, the fonts (loaded before the desktop is revealed), the
//   icons, app names and glass looks (libs/theme registries), and the appearance lock for a
//   theme made for Dark or Light only.
// The start-up veil waits for the theme ('theme' in bootReveal.js), so it never flashes
// iWeb's own look first.
import { useSyncExternalStore } from 'react';
import { createStoredPref } from '../prefs/storedPref.js';
import { extendBootCap, markBootReady } from '../boot/bootReveal.js';
import { setAppearanceLock } from '../appearance/appearance.js';
import { themedGlass, themedIcons } from './icons.js';
import { themedNames } from './names.js';
import { resetSounds, themedSounds } from './sounds.js';
import { deleteTheme, getTheme, listThemes, putTheme } from './themeStore.js';
import { CURRENT_VERSION } from '../updater/updater.js';
import { addLocalRecord, findLocalByHash } from '../wallpaper/repository.js';
import { makeThumbnail, sha256Hex as blobHash } from '../wallpaper/imageLoader.js';
import { setActiveWallpaper } from '../wallpaper/settings.js';
import { broadcast } from '../wallpaper/sync.js';

export const BUILT_IN_THEME = 'iweb'; // also in format.js (kept apart: that one loads PostCSS)
const ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const FONT_WAIT_MS = 1500;

export const activeThemePref = createStoredPref({
  key: 'theme_active',
  mirrorKey: 'iweb:theme',
  fallback: BUILT_IN_THEME,
  normalize: (v) => (typeof v === 'string' && ID.test(v) ? v : null),
});

// ---- State for the UI -----------------------------------------------------------------

let state = { installed: [], applied: BUILT_IN_THEME, missing: null, ready: false };
const listeners = new Set();
function setState(patch) {
  state = { ...state, ...patch };
  for (const cb of [...listeners]) cb();
}
const subscribe = (cb) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
/** { installed: [summary], applied: id, missing: id | null, ready } */
export const useThemes = () => useSyncExternalStore(subscribe, () => state, () => state);

/** What the UI shows of an installed theme (no files). */
export const summarize = (record) => ({
  id: record.id,
  ...record.manifest,
  source: record.source,
  sha256: record.sha256 || null,
  hasWallpaper: Boolean(record.tokens?.wallpaper),
  hasSounds: Object.keys(record.tokens?.sounds || {}).length > 0,
  removed: record.removed || [],
  installedAt: record.installedAt,
  updatedAt: record.updatedAt,
});

async function refreshList() {
  const records = await listThemes().catch(() => []);
  setState({ installed: records.map(summarize).sort((a, b) => a.name.localeCompare(b.name)) });
  return records;
}

// ---- The stylesheet of a theme's tokens ------------------------------------------------

/**
 * The CSS for a theme's tokens and accent. The selectors outweigh tokens.css and accent.css
 * (including their Light and accent-colour rules), so the theme's values win.
 */
export function tokenCss(id, tokens) {
  const root = `:root[data-theme="${id}"][data-theme]`;
  const decls = (values, accent) => [
    ...Object.entries(values || {}).map(([k, v]) => `  --iw-${k}: ${v};`),
    ...(accent ? [`  --accent-rgb: ${accent};`] : []),
  ].join('\n');
  const dark = decls(tokens.tokens, tokens.accent);
  const light = decls(tokens.light, tokens.accentLight || tokens.accent);
  return [
    dark && `${root} {\n${dark}\n}`,
    light && `${root}[data-appearance="light"] {\n${light}\n}`,
  ].filter(Boolean).join('\n');
}

// ---- Applying -------------------------------------------------------------------------

let current = { id: BUILT_IN_THEME, urls: [], fonts: [] };
let applySeq = 0;

function styleEl(id) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.append(el);
  }
  keepLast();
  return el;
}

// The theme's styles stay the last in <head>: stylesheets that load later (a window's CSS
// arrives when it first opens) would otherwise win over the theme at equal specificity.
let headObserver = null;
function keepLast() {
  const order = () => {
    const tokens = document.getElementById('iweb-theme-tokens');
    const skin = document.getElementById('iweb-theme-skin');
    const ours = [tokens, skin].filter(Boolean);
    if (!ours.length) return;
    const tail = [...document.head.children].slice(-ours.length);
    if (ours.every((el, i) => tail[i] === el)) return;
    document.head.append(...ours);
  };
  order();
  if (headObserver) return;
  headObserver = new MutationObserver(order);
  headObserver.observe(document.head, { childList: true });
}

function teardown() {
  for (const url of current.urls) URL.revokeObjectURL(url);
  for (const face of current.fonts) document.fonts.delete(face);
  document.getElementById('iweb-theme-tokens')?.remove();
  document.getElementById('iweb-theme-skin')?.remove();
  themedIcons.set({});
  themedNames.set({});
  themedGlass.set({});
  themedSounds.set({});
  resetSounds();
  setAppearanceLock(null);
  current = { id: BUILT_IN_THEME, urls: [], fonts: [] };
}

async function loadFonts(faces) {
  const loading = faces.map((face) => face.load().catch((err) => console.warn('[theme] A font could not load:', err)));
  await Promise.race([Promise.all(loading), new Promise((r) => setTimeout(r, FONT_WAIT_MS))]);
}

/** Puts a theme record (or null: iWeb's own look) on the page. */
async function applyRecord(record) {
  const seq = ++applySeq;
  const root = document.documentElement;
  if (!record) {
    teardown();
    root.dataset.theme = BUILT_IN_THEME;
    setState({ applied: BUILT_IN_THEME });
    return;
  }

  // Everything is prepared first, then swapped in at once (no half-themed frame).
  const urls = {};
  for (const [path, blob] of Object.entries(record.files || {})) urls[path] = URL.createObjectURL(blob);
  const fonts = record.manifest.fonts
    .filter((f) => urls[f.src])
    .map((f) => new FontFace(f.family, `url("${urls[f.src]}")`, { weight: f.weight, style: f.style }));
  fonts.forEach((face) => document.fonts.add(face));
  await loadFonts(fonts);
  if (seq !== applySeq) {
    // A newer theme was chosen meanwhile.
    Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    fonts.forEach((face) => document.fonts.delete(face));
    return;
  }

  teardown();
  current = { id: record.id, urls: Object.values(urls), fonts };
  root.dataset.theme = record.id;
  styleEl('iweb-theme-tokens').textContent = tokenCss(record.id, record.tokens);
  styleEl('iweb-theme-skin').textContent = (record.css || '').replace(
    /url\("iwtheme:([^"]+)"\)/g,
    (_, path) => (urls[path] ? `url("${urls[path]}")` : 'none'),
  );
  const icons = {};
  for (const [key, path] of Object.entries(record.tokens.icons || {})) if (urls[path]) icons[key] = urls[path];
  themedIcons.set(icons);
  themedNames.set(record.tokens.names || {});
  themedGlass.set({ dark: record.tokens.glass || {}, light: record.tokens.glassLight || {}, off: record.tokens.glassEffect === 'off' });
  const sounds = {};
  for (const [event, path] of Object.entries(record.tokens.sounds || {})) if (urls[path]) sounds[event] = urls[path];
  themedSounds.set(sounds);
  setAppearanceLock(record.manifest.appearance === 'both' ? null : record.manifest.appearance);
  setState({ applied: record.id });
}

/** Applies the theme the setting names; falls back to iWeb's own if it isn't installed. */
async function applyActive() {
  const id = activeThemePref.get();
  if (id === BUILT_IN_THEME) {
    await applyRecord(null);
    setState({ missing: null });
    return;
  }
  const record = await getTheme(id).catch((err) => {
    console.warn('[theme] Could not read the theme:', err);
    return null;
  });
  if (activeThemePref.get() !== id) return; // changed meanwhile
  if (!record) {
    // Restored from a backup, or removed in another tab: iWeb's own look until it's installed.
    setState({ missing: id });
    await applyRecord(null);
    return;
  }
  setState({ missing: null });
  await applyRecord(record);
}

let started = false;
/** At start: the theme before the desktop is revealed, then follows the setting. */
export function startTheme() {
  if (started) return;
  started = true;
  document.documentElement.dataset.theme = activeThemePref.get();
  // A theme's fonts and files take a moment to load: the veil may wait a little longer.
  if (activeThemePref.get() !== BUILT_IN_THEME) extendBootCap(FONT_WAIT_MS + 300);
  applyActive()
    .catch((err) => console.warn('[theme] Could not apply the theme:', err))
    .finally(() => {
      markBootReady('theme');
      setState({ ready: true });
    });
  refreshList();
  activeThemePref.subscribe(() => {
    applyActive().catch((err) => console.warn('[theme] Could not apply the theme:', err));
  });
  activeThemePref.load?.();
  // Another tab installed or removed a theme.
  window.addEventListener('storage', (e) => {
    if (e.key === 'iweb:themesChanged') refreshList().then(() => applyActive());
  });
}

function announceChange() {
  try {
    localStorage.setItem('iweb:themesChanged', String(Date.now()));
  } catch {
    // Storage blocked: other tabs see it when reloaded.
  }
}

// ---- Installing -----------------------------------------------------------------------

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The running iWeb's version ("3.2"), or null for a local build. */
const iwebVersion = () => (CURRENT_VERSION ? CURRENT_VERSION.slice(0, 3).join('.') : null);

/**
 * Installs (or updates) a theme from a zip: a File, Blob or ArrayBuffer. Checked completely
 * before anything is saved. `expectedSha256` (from the Theme Store) must match when given.
 * Resolves to the installed theme's summary; rejects with a ThemeError.
 */
export async function installTheme(data, { source = 'file', expectedSha256 = null, expect = null } = {}) {
  const [{ readThemePackage, ThemeError }, { default: JSZip }] = await Promise.all([import('./format.js'), import('jszip')]);
  const buffer = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
  const sha256 = await sha256Hex(buffer);
  if (expectedSha256 && expectedSha256.toLowerCase() !== sha256) {
    throw new ThemeError('BAD_CHECKSUM', "The downloaded theme doesn't match the Theme Store's checksum, so it wasn't installed.");
  }
  const pkg = await readThemePackage(buffer, JSZip, { iwebVersion: iwebVersion() });
  // From the store: the package must be the theme and version its catalogue entry names.
  if (expect && (pkg.manifest.id !== expect.id || pkg.manifest.version !== expect.version)) {
    throw new ThemeError('MISMATCH', `The download is ${pkg.manifest.id} ${pkg.manifest.version}, not ${expect.id} ${expect.version}, so it wasn't installed.`);
  }
  const files = {};
  for (const [path, { type, bytes }] of Object.entries(pkg.files)) files[path] = new Blob([bytes], { type });
  const existing = await getTheme(pkg.manifest.id).catch(() => null);
  const now = Date.now();
  const record = {
    id: pkg.manifest.id,
    manifest: pkg.manifest,
    tokens: pkg.tokens,
    css: pkg.css,
    removed: pkg.removed,
    files,
    source,
    sha256,
    installedAt: existing?.installedAt || now,
    updatedAt: now,
  };
  await putTheme(record);
  await refreshList();
  announceChange();
  if (state.applied === record.id || state.missing === record.id) await applyActive();
  return summarize(record);
}

/** Uses an installed theme (or BUILT_IN_THEME). */
export function selectTheme(id) {
  activeThemePref.set(id);
}

/** Removes an installed theme; iWeb's own look comes back if it was in use. */
export async function uninstallTheme(id) {
  if (activeThemePref.get() === id) activeThemePref.set(BUILT_IN_THEME);
  await deleteTheme(id);
  await refreshList();
  announceChange();
}

/** The preview image of an installed theme as a blob: URL (the caller revokes it), or null. */
export async function themePreviewUrl(id) {
  const record = await getTheme(id).catch(() => null);
  const path = record?.manifest.previews?.[0];
  return path && record.files[path] ? URL.createObjectURL(record.files[path]) : null;
}

/**
 * Adds a theme's wallpaper to the wallpaper library (once: matched by content) and shows it.
 * It's then an ordinary wallpaper: it stays if the theme is removed.
 */
export async function applyThemeWallpaper(id) {
  const record = await getTheme(id);
  const path = record?.tokens?.wallpaper;
  const blob = path && record.files[path];
  if (!blob) return false;
  const hash = await blobHash(blob);
  let localId = await findLocalByHash(hash); // the id of the same image, if it's there
  if (localId == null) {
    const thumb = await makeThumbnail(blob).catch(() => null);
    localId = await addLocalRecord({ blob, thumb, name: `${record.manifest.name} wallpaper`, type: blob.type, size: blob.size, hash });
    broadcast('library-changed');
  }
  setActiveWallpaper({ source: 'local', id: localId });
  return true;
}
