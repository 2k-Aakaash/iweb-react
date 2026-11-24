// The Theme Store's catalogue (docs/THEMES.md): the `store` release of the themes repo on
// GitHub, built by that repo's workflow. Its assets:
//
//   index.json            { format: 1, updatedAt, themes: [entry] }
//   <id>-<version>.zip    each theme's package
//   <id>-<n>.<ext>        preview images
//
// An entry: { id, name, version, author, description, appearance, license, minIweb, tags,
// size, sha256, zip, previews: [asset name] }. Every entry is checked here; a download must
// match its sha256 and its package must be the theme and version the entry names
// (engine.installTheme).
import { BUILT_IN_THEME, installTheme } from './engine.js';
import { compareVersionsLite as newer } from './versions.js';

export const THEMES_REPO = import.meta.env.VITE_IWEB_THEMES_REPO || '2k-Aakaash/iweb-themes';
export const STORE_TAG = 'store';
const RELEASE_API = `https://api.github.com/repos/${THEMES_REPO}/releases/tags/${STORE_TAG}`;
export const STORE_PAGE = `https://github.com/${THEMES_REPO}`;
const CACHE_KEY = 'iweb:themeStore';
const CACHE_MS = 6 * 60 * 60 * 1000;
const MAX_INDEX_BYTES = 512 * 1024;
const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 3 * 1024 * 1024;

export class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

const ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const ASSET = /^[\w.-]{1,120}$/;
const plain = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : ''); // eslint-disable-line no-control-regex

/** The entries of index.json that are complete and safe to show, given the release's assets. */
export function validateIndex(raw, assetNames) {
  if (!raw || typeof raw !== 'object' || raw.format !== 1 || !Array.isArray(raw.themes)) {
    throw new StoreError('BAD_INDEX', "The Theme Store's catalogue couldn't be read.");
  }
  const seen = new Set();
  const themes = [];
  for (const t of raw.themes.slice(0, 500)) {
    if (!t || typeof t !== 'object') continue;
    if (!ID.test(t.id) || t.id === BUILT_IN_THEME || seen.has(t.id)) continue;
    if (!VERSION.test(t.version) || !/^[0-9a-f]{64}$/i.test(t.sha256 || '')) continue;
    if (!ASSET.test(t.zip || '') || !assetNames.has(t.zip)) continue;
    const name = plain(t.name, 40);
    const author = plain(t.author, 60);
    if (!name || !author) continue;
    seen.add(t.id);
    themes.push({
      id: t.id,
      name,
      version: t.version,
      author,
      description: plain(t.description, 280),
      appearance: ['dark', 'light', 'both'].includes(t.appearance) ? t.appearance : 'both',
      license: plain(t.license, 60),
      minIweb: /^\d{1,4}\.\d{1,4}(\.\d{1,4})?$/.test(t.minIweb || '') ? t.minIweb : null,
      tags: (Array.isArray(t.tags) ? t.tags : []).map((x) => plain(x, 24)).filter(Boolean).slice(0, 8),
      size: Number.isFinite(t.size) && t.size > 0 ? t.size : null,
      sha256: t.sha256.toLowerCase(),
      zip: t.zip,
      previews: (Array.isArray(t.previews) ? t.previews : []).filter((p) => ASSET.test(p) && assetNames.has(p)).slice(0, 4),
    });
  }
  return { updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null, themes };
}

// ---- GitHub ---------------------------------------------------------------------------

async function getJson(url, signal) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new StoreError('NETWORK', "Couldn't reach the Theme Store. Check your connection and try again.");
  }
  if (res.status === 404) throw new StoreError('NOT_OPEN', "The Theme Store has no themes yet. Check back soon.");
  if (res.status === 403 || res.status === 429) throw new StoreError('RATE_LIMITED', 'GitHub is limiting requests right now. Try again in a while.');
  if (!res.ok) throw new StoreError('HTTP', `The Theme Store couldn't be loaded (HTTP ${res.status}).`);
  return res.json();
}

/** A release asset's bytes, no larger than `max`. */
async function downloadAsset(asset, max, signal) {
  if (asset.size && asset.size > max) throw new StoreError('TOO_BIG', 'This download is larger than allowed.');
  let res;
  try {
    // The direct download (allowed for the extension); the API's asset endpoint otherwise.
    res = await fetch(asset.url, { cache: 'no-store', signal }).catch(() => null);
    if (!res?.ok && asset.apiUrl) res = await fetch(asset.apiUrl, { headers: { Accept: 'application/octet-stream' }, cache: 'no-store', signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new StoreError('NETWORK', 'The download failed. Check your connection and try again.');
  }
  if (!res?.ok) throw new StoreError('HTTP', `The download failed${res ? ` (HTTP ${res.status})` : ''}.`);
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > max) throw new StoreError('TOO_BIG', 'This download is larger than allowed.');
  return buffer;
}

// ---- The catalogue --------------------------------------------------------------------

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeCache(value) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the catalogue is just fetched again next time.
  }
}

/** The catalogue (cached for 6 hours unless `force`): { themes, updatedAt, checkedAt, assets }. */
export async function loadStore({ force = false, signal } = {}) {
  const cached = readCache();
  if (!force && cached && Date.now() - cached.checkedAt < CACHE_MS) return cached;
  const release = await getJson(RELEASE_API, signal);
  const assets = {};
  for (const a of Array.isArray(release.assets) ? release.assets : []) {
    if (typeof a?.name === 'string' && typeof a.browser_download_url === 'string') {
      assets[a.name] = { url: a.browser_download_url, apiUrl: typeof a.url === 'string' ? a.url : null, size: a.size || null };
    }
  }
  if (!assets['index.json']) throw new StoreError('NOT_OPEN', 'The Theme Store has no themes yet. Check back soon.');
  const text = new TextDecoder().decode(await downloadAsset(assets['index.json'], MAX_INDEX_BYTES, signal));
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new StoreError('BAD_INDEX', "The Theme Store's catalogue couldn't be read.");
  }
  const index = validateIndex(raw, new Set(Object.keys(assets)));
  const value = { ...index, assets, checkedAt: Date.now() };
  writeCache(value);
  return value;
}

/** The cached catalogue, without going online (null if never loaded). */
export const cachedStore = () => readCache();

/** Store entries newer than the installed theme with the same id. */
export function updatesFor(store, installed) {
  if (!store?.themes) return [];
  return store.themes.filter((t) => {
    const mine = installed.find((i) => i.id === t.id);
    return mine && newer(t.version, mine.version) > 0;
  });
}

const previewCache = new Map(); // asset name -> blob: URL (kept for the session)

/** A preview image of a store entry as a blob: URL, or null. */
export async function storePreviewUrl(store, name, signal) {
  if (!name || !store.assets[name]) return null;
  if (previewCache.has(name)) return previewCache.get(name);
  const buffer = await downloadAsset(store.assets[name], MAX_PREVIEW_BYTES, signal);
  const type = {
    png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', svg: 'image/svg+xml',
  }[/\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase()] || 'image/jpeg';
  const url = URL.createObjectURL(new Blob([buffer], { type }));
  previewCache.set(name, url);
  return url;
}

/** Downloads, checks and installs (or updates) a theme from the store. */
export async function installFromStore(store, entry, { signal } = {}) {
  const asset = store.assets[entry.zip];
  if (!asset) throw new StoreError('NOT_FOUND', "This theme's download is missing from the store.");
  const buffer = await downloadAsset(asset, Math.min(MAX_ZIP_BYTES, entry.size ? entry.size + 1024 : MAX_ZIP_BYTES), signal);
  return installTheme(buffer, { source: 'store', expectedSha256: entry.sha256, expect: { id: entry.id, version: entry.version } });
}
