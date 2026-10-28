// Saves a wallpaper from the library to the user's computer (the browser's Downloads, or the
// Save As dialog if the browser asks where to save).
//
// Unsplash photos follow the API guidelines: the download is reported through the photo's
// download_location (which also returns the full-size original), and the file is named the
// way Unsplash names its own downloads: "<photographer>-<photo id>-unsplash.jpg". Without a
// connection Unsplash can't be told, so no file is saved.
import { saveAs } from 'file-saver';
import { getWallpaperRecord } from './repository.js';
import { trackDownload } from './unsplashClient.js';

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

export class DownloadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DownloadError';
    this.code = code;
  }
}

const extensionFor = (type, fallback = 'jpg') => EXTENSIONS[(type || '').toLowerCase()] || fallback;

/** "ash-saribekyan" from "Ash Saribekyan" (accents dropped, anything else to hyphens). */
export function slugify(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Unsplash's download name: "ash-saribekyan-AbC123-unsplash.jpg". */
export function unsplashFileName({ photographer, photoId }, type) {
  const who = slugify(photographer?.name) || slugify(photographer?.username);
  const id = String(photoId || '').replace(/[^A-Za-z0-9_-]/g, '');
  return `${[who, id, 'unsplash'].filter(Boolean).join('-')}.${extensionFor(type)}`;
}

/** The imported file's own name, with an extension that matches its type. */
export function localFileName({ id, name }, type) {
  const ext = extensionFor(type, 'png');
  // Windows forbids <>:"/\|?* and control characters in file names.
  const base = [...String(name || '')]
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .trim()
    .slice(0, 100);
  return `${base || `iweb-wallpaper-${id}`}.${ext}`;
}

async function fetchImage(url, signal) {
  const res = await fetch(url, { signal, credentials: 'omit' });
  if (!res.ok) throw new DownloadError('FETCH_FAILED', 'The photo couldn’t be downloaded.');
  return res.blob();
}

/**
 * Downloads the wallpaper `ref` ({ source: 'local' | 'unsplash', id }). Resolves to the
 * file name used. `save` and `online` are injectable for tests.
 */
export async function downloadWallpaper(ref, { signal, save = saveAs, online = () => navigator.onLine } = {}) {
  const record = await getWallpaperRecord(ref);
  if (!record) throw new DownloadError('NOT_FOUND', 'This wallpaper is no longer in your library.');

  if (ref.source === 'local') {
    if (!(record.blob instanceof Blob)) throw new DownloadError('NOT_FOUND', 'This image’s file is missing.');
    const fileName = localFileName(record, record.blob.type || record.type);
    save(record.blob, fileName);
    return fileName;
  }

  if (!online()) {
    throw new DownloadError('OFFLINE', 'Connect to the internet to download Unsplash photos.');
  }
  if (!record.downloadLocation) {
    throw new DownloadError('NOT_FOUND', 'This photo can’t be downloaded.');
  }
  // Reporting the download is required, and gives the full-size original.
  const fullUrl = await trackDownload(record.downloadLocation, { signal });
  const blob = await fetchImage(fullUrl || record.urls?.full || record.urls?.raw, signal);
  const fileName = unsplashFileName(record, blob.type);
  save(blob, fileName);
  return fileName;
}
