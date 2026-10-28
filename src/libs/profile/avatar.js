// The user's profile photo (Settings sidebar), stored in iWebDB `profile` under key 'avatar'.
// Uploads are centre-cropped to a square and scaled to AVATAR_SIZE, so the stored image stays
// small whatever the user picks. Changes are broadcast on window as AVATAR_EVENT.
import { openIwebDB, reqToPromise, STORES, txDone } from '../wallpaper/db.js';

export const AVATAR_SIZE = 256;
export const AVATAR_EVENT = 'iweb:avatar';
const KEY = 'avatar';
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export class AvatarError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AvatarError';
  }
}

/** The source square to crop from a w×h image: centred, as large as fits. */
export function centerSquare(width, height) {
  const side = Math.min(width, height);
  return { sx: Math.round((width - side) / 2), sy: Math.round((height - side) / 2), side };
}

/** "GU" for "Grant User", "B" for "BOT", "" for nothing. */
export function initialsOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const letters = words.length === 1 ? [...words[0]].slice(0, 1) : [[...words[0]][0], [...words[words.length - 1]][0]];
  return letters.join('').toUpperCase();
}

export async function getAvatar() {
  const db = await openIwebDB();
  const tx = db.transaction(STORES.PROFILE, 'readonly');
  const record = await reqToPromise(tx.objectStore(STORES.PROFILE).get(KEY));
  return record?.blob instanceof Blob ? record.blob : null;
}

async function putAvatar(blob) {
  const db = await openIwebDB();
  const tx = db.transaction(STORES.PROFILE, 'readwrite');
  const store = tx.objectStore(STORES.PROFILE);
  if (blob) store.put({ key: KEY, blob, updatedAt: Date.now() });
  else store.delete(KEY);
  await txDone(tx);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(AVATAR_EVENT));
}

/** Crops and scales an image file to the avatar size (WebP, or PNG where WebP isn't encoded). */
async function resizeToAvatar(file) {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new AvatarError('That image couldn’t be opened. Try a JPEG or PNG.');
  });
  const { sx, sy, side } = centerSquare(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close?.();
  const toBlob = (type) => new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
  const webp = await toBlob('image/webp');
  return webp?.type === 'image/webp' ? webp : toBlob('image/png');
}

/** Saves an uploaded image file as the profile photo. */
export async function setAvatarFromFile(file) {
  if (!file || !/^image\//.test(file.type)) throw new AvatarError('Choose an image file.');
  if (file.size > MAX_UPLOAD_BYTES) throw new AvatarError('That image is too large (20 MB at most).');
  const blob = await resizeToAvatar(file);
  if (!blob) throw new AvatarError('That image couldn’t be processed.');
  await putAvatar(blob);
}

export function removeAvatar() {
  return putAvatar(null);
}
