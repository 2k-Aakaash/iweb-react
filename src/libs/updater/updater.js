/* global chrome */
// Self-update for the unpacked iWeb extension.
//
// Chrome never updates unpacked extensions and gives them no write access to their
// own install folder. So the update flow is:
//   1. Check the latest GitHub release of the iWeb repo (cached, a few times a day).
//   2. The user grants read/write access to the folder the extension was loaded from
//      (File System Access API, once; the handle is persisted in IndexedDB).
//   3. "Update now" downloads iWeb.Extension.zip, verifies its SHA-256 against the
//      published .sha256 asset, writes the files into that folder and reloads the
//      extension (chrome.runtime.reload re-reads unpacked files from disk).

import JSZip from 'jszip';
import { openIwebDB, reqToPromise, STORES } from '../wallpaper/db';

export const RELEASES_REPO = import.meta.env.VITE_IWEB_RELEASES_REPO || '2k-Aakaash/iWeb';
const REPO = RELEASES_REPO;
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const ZIP_ASSET = 'iWeb.Extension.zip';
const SHA_ASSET = 'iWeb.Extension.zip.sha256';
const FILE_LIST = 'release-files.json';

const CHECK_CACHE_KEY = 'iwebUpdateCheck';
const DISMISSED_KEY = 'iwebUpdateDismissed';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Folder handle lives in the shared iWebDB key/value meta store (no schema change needed).
const FOLDER_HANDLE_KEY = 'extension_folder_handle';
// chrome.storage.local key read by public/service-worker.js after the reload (keep in sync).
const REOPEN_KEY = 'iweb:reopenAfterUpdate';
const MAX_ZIP_BYTES = 50 * 1024 * 1024;

// Release tag baked in by the release workflow ("v2.3", "v2.3.1"; older builds used
// "v2.2-build.5"); empty for local builds.
export const CURRENT_TAG = (import.meta.env.VITE_IWEB_RELEASE_TAG || '').trim();
export const CURRENT_VERSION = parseVersion(CURRENT_TAG);

export class UpdateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'UpdateError';
    this.code = code;
  }
}

export function parseBuildNumber(tag) {
  const match = /-build\.(\d+)\b/.exec(tag || '');
  return match ? Number(match[1]) : null;
}

// A workflow release: "v2.3", "v2.3.1", "v2.2-build.5", optionally prefixed "iWeb " (release
// names). Anything else (e.g. the old hand-made "v2.0.2alpha") is not a release.

/** [major, minor, patch, build] for a release tag/name, or null. */
export function parseVersion(text) {
  const match = /^(?:iweb\s+)?v(\d+)\.(\d+)(?:\.(\d+))?(?:-build\.(\d+))?$/i.exec((text || '').trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] || 0), Number(match[4] || 0)];
}

/** > 0 when a is newer than b. */
export function compareVersions(a, b) {
  for (let i = 0; i < 4; i += 1) {
    const diff = (a?.[i] ?? 0) - (b?.[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

function isExtensionPage() {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
}

/**
 * What this installation can do:
 *  - 'release'      : extension built by the release workflow → check + one-click update
 *  - 'dev'          : local build (no release tag) → updates disabled
 *  - 'web'          : website/PWA → updated by Vercel, nothing to do
 */
export function getUpdateMode() {
  if (!isExtensionPage()) return 'web';
  return CURRENT_VERSION === null ? 'dev' : 'release';
}

export function canWriteFolder() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

// ---------------------------------------------------------------------------
// Checking

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable; the check simply isn't cached.
  }
}

function normalizeRelease(json) {
  const tag = typeof json?.tag_name === 'string' ? json.tag_name : '';
  const name = typeof json?.name === 'string' ? json.name.trim() : '';
  // Version from the tag ("v2.3.1"), or from the release name when the tag was renamed
  // by hand ("v2.2" named "iWeb v2.2-build.3" → the name carries the build number).
  const fromTag = parseVersion(tag);
  const fromName = parseVersion(name);
  const version = fromTag && fromName && compareVersions(fromName, fromTag) > 0 ? fromName : (fromTag || fromName);
  const assets = Array.isArray(json?.assets) ? json.assets : [];
  const zip = assets.find((a) => a?.name === ZIP_ASSET);
  const sha = assets.find((a) => a?.name === SHA_ASSET);
  if (!tag || !version || !zip?.browser_download_url) return null;
  return {
    tag,
    version,
    build: version[3],
    name: name || tag,
    notes: typeof json.body === 'string' ? json.body.slice(0, 4000) : '',
    url: typeof json.html_url === 'string' ? json.html_url : `https://github.com/${REPO}/releases`,
    publishedAt: json.published_at || null,
    zipUrl: zip.browser_download_url,
    zipSize: zip.size || null,
    shaUrl: sha?.browser_download_url || null,
  };
}

function withStatus(latest, checkedAt) {
  return {
    current: { tag: CURRENT_TAG || null, version: CURRENT_VERSION },
    latest,
    checkedAt,
    available: Boolean(latest && CURRENT_VERSION && compareVersions(latest.version, CURRENT_VERSION) > 0),
  };
}

/** Latest-release status. Uses a 6-hour cache unless `force` is set. */
export async function checkForUpdate({ force = false, signal } = {}) {
  const cached = readJson(CHECK_CACHE_KEY);
  if (!force && cached && Date.now() - cached.checkedAt < CHECK_INTERVAL_MS) {
    return withStatus(cached.latest, cached.checkedAt);
  }
  let res;
  try {
    res = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new UpdateError('NETWORK', 'Couldn’t reach GitHub to check for updates.');
  }
  if (res.status === 403 || res.status === 429) {
    throw new UpdateError('RATE_LIMITED', 'GitHub is rate-limiting update checks. Try again later.');
  }
  if (!res.ok) throw new UpdateError('HTTP', `Update check failed (HTTP ${res.status}).`);
  const latest = normalizeRelease(await res.json());
  const checkedAt = Date.now();
  writeJson(CHECK_CACHE_KEY, { checkedAt, latest });
  return withStatus(latest, checkedAt);
}

export function isDismissed(tag) {
  return readJson(DISMISSED_KEY) === tag;
}

export function dismissUpdate(tag) {
  writeJson(DISMISSED_KEY, tag);
}

// ---------------------------------------------------------------------------
// Extension folder access

async function metaGet(key) {
  const db = await openIwebDB();
  const row = await reqToPromise(db.transaction(STORES.META, 'readonly').objectStore(STORES.META).get(key));
  return row?.value ?? null;
}

async function metaPut(key, value) {
  const db = await openIwebDB();
  await reqToPromise(db.transaction(STORES.META, 'readwrite').objectStore(STORES.META).put({ key, value }));
}

async function readTextFile(dir, name) {
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    return await file.text();
  } catch {
    return null;
  }
}

/** Confirms the folder is this extension's unpacked folder (same manifest name + new-tab override). */
async function assertExtensionFolder(dir) {
  const text = await readTextFile(dir, 'manifest.json');
  let manifest;
  try {
    manifest = text ? JSON.parse(text) : null;
  } catch {
    manifest = null;
  }
  const expectedName = isExtensionPage() ? chrome.runtime.getManifest().name : null;
  if (!manifest?.chrome_url_overrides?.newtab || (expectedName && manifest.name !== expectedName)) {
    throw new UpdateError(
      'WRONG_FOLDER',
      'That folder isn’t the iWeb extension folder. Pick the folder you chose in chrome://extensions → Load unpacked (it contains manifest.json).',
    );
  }
}

/** Name of the remembered extension folder, or null. */
export async function getSavedFolderName() {
  const handle = await metaGet(FOLDER_HANDLE_KEY).catch(() => null);
  return handle?.name || null;
}

/** Asks the user for the unpacked extension folder (must be called from a click). */
export async function chooseExtensionFolder() {
  if (!canWriteFolder()) throw new UpdateError('UNSUPPORTED', 'This browser can’t write to folders.');
  let dir;
  try {
    dir = await window.showDirectoryPicker({ id: 'iweb-extension-folder', mode: 'readwrite' });
  } catch (err) {
    if (err?.name === 'AbortError') throw new UpdateError('CANCELLED', 'Folder selection cancelled.');
    throw err;
  }
  await assertExtensionFolder(dir);
  await metaPut(FOLDER_HANDLE_KEY, dir);
  return dir.name;
}

async function getWritableFolder() {
  const dir = await metaGet(FOLDER_HANDLE_KEY);
  if (!dir) throw new UpdateError('NO_FOLDER', 'Choose the extension folder first.');
  const opts = { mode: 'readwrite' };
  if ((await dir.queryPermission(opts)) !== 'granted' && (await dir.requestPermission(opts)) !== 'granted') {
    throw new UpdateError('PERMISSION', 'Write access to the extension folder was not granted.');
  }
  await assertExtensionFolder(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// Applying an update

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function download(url, { signal, asText = false } = {}) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-store', signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new UpdateError('NETWORK', 'Download failed. Check your connection and try again.');
  }
  if (!res.ok) throw new UpdateError('HTTP', `Download failed (HTTP ${res.status}).`);
  return asText ? res.text() : res.arrayBuffer();
}

// Only plain relative paths inside the folder; rejects "..", absolute and odd segments.
function safeSegments(path) {
  const parts = path.split('/').filter(Boolean);
  if (!parts.length || parts.some((p) => p === '.' || p === '..' || p.includes('\\') || p.includes(':'))) {
    return null;
  }
  return parts;
}

async function writeFile(root, parts, data) {
  let dir = root;
  for (const segment of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(segment, { create: true });
  }
  const file = await dir.getFileHandle(parts[parts.length - 1], { create: true });
  const writable = await file.createWritable();
  await writable.write(data);
  await writable.close();
}

async function removeFile(root, parts) {
  try {
    let dir = root;
    for (const segment of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(segment);
    await dir.removeEntry(parts[parts.length - 1]);
  } catch {
    // Already gone.
  }
}

// Entry points last: until index.html and manifest.json are replaced, the running
// version keeps referencing its own (still present) hashed asset files.
function writeOrder(path) {
  if (path === 'manifest.json') return 2;
  if (path === 'index.html') return 1;
  return 0;
}

/**
 * Downloads, verifies and installs `latest`, then reloads the extension.
 * Must be started from a user click (folder permission prompt).
 * onProgress({ phase: 'permission'|'download'|'verify'|'write'|'cleanup'|'reload', done?, total? })
 */
export async function applyUpdate(latest, { onProgress = () => {}, signal } = {}) {
  if (getUpdateMode() !== 'release') throw new UpdateError('UNSUPPORTED', 'Updates are only available in release builds of the extension.');
  if (!latest?.zipUrl) throw new UpdateError('NO_RELEASE', 'No downloadable release was found.');

  // Permission first, while the click's user activation is still valid.
  onProgress({ phase: 'permission' });
  const root = await getWritableFolder();

  onProgress({ phase: 'download' });
  if (latest.zipSize && latest.zipSize > MAX_ZIP_BYTES) throw new UpdateError('TOO_LARGE', 'The update package is unexpectedly large.');
  const [zipBuffer, shaText] = await Promise.all([
    download(latest.zipUrl, { signal }),
    latest.shaUrl ? download(latest.shaUrl, { signal, asText: true }) : Promise.resolve(null),
  ]);
  if (zipBuffer.byteLength > MAX_ZIP_BYTES) throw new UpdateError('TOO_LARGE', 'The update package is unexpectedly large.');

  onProgress({ phase: 'verify' });
  if (!shaText) throw new UpdateError('NO_CHECKSUM', 'This release has no checksum file, so it can’t be verified.');
  const expected = shaText.trim().split(/\s+/)[0].toLowerCase();
  if (expected !== (await sha256Hex(zipBuffer))) {
    throw new UpdateError('CHECKSUM', 'The download didn’t match its checksum. Nothing was changed.');
  }

  const zip = await JSZip.loadAsync(zipBuffer);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => ({ entry, path: entry.name.replace(/^\.\//, ''), parts: safeSegments(entry.name.replace(/^\.\//, '')) }));
  if (entries.some((e) => !e.parts)) throw new UpdateError('BAD_PACKAGE', 'The update package contains unsafe paths.');
  if (!entries.some((e) => e.path === 'manifest.json') || !entries.some((e) => e.path === 'index.html')) {
    throw new UpdateError('BAD_PACKAGE', 'The update package is missing manifest.json or index.html.');
  }

  const previousList = JSON.parse((await readTextFile(root, FILE_LIST)) || '[]');

  entries.sort((a, b) => writeOrder(a.path) - writeOrder(b.path));
  for (let i = 0; i < entries.length; i += 1) {
    if (signal?.aborted) throw new DOMException('Update cancelled', 'AbortError');
    onProgress({ phase: 'write', done: i, total: entries.length });
    const data = await entries[i].entry.async('uint8array');
    await writeFile(root, entries[i].parts, data);
  }

  // Remove files from the previous release that the new one no longer ships.
  onProgress({ phase: 'cleanup' });
  const newPaths = new Set(entries.map((e) => e.path));
  if (Array.isArray(previousList)) {
    for (const oldPath of previousList) {
      const parts = typeof oldPath === 'string' ? safeSegments(oldPath) : null;
      if (parts && !newPaths.has(oldPath)) await removeFile(root, parts);
    }
  }

  writeJson(CHECK_CACHE_KEY, null);
  onProgress({ phase: 'reload' });
  // Reloading unloads the extension, so Chrome swaps this tab to its default new tab page.
  // Remember the tab; the service worker opens iWeb in it again once the update is running.
  try {
    const tab = await chrome.tabs.getCurrent();
    await chrome.storage.local.set({ [REOPEN_KEY]: { tabId: tab?.id ?? null, at: Date.now() } });
  } catch {
    // Reopening is a nicety; the update itself is done.
  }
  chrome.runtime.reload();
}
