// Installed themes in iWebDB (the `themes` store): one record per theme, keyed by id.
//   { id, manifest, tokens, css, removed, files: { path: Blob }, source: 'file' | 'store',
//     sha256, installedAt, updatedAt }
import { openIwebDB, reqToPromise, STORES } from '../wallpaper/db.js';

async function store(mode) {
  const db = await openIwebDB();
  return db.transaction(STORES.THEMES, mode).objectStore(STORES.THEMES);
}

export async function getTheme(id) {
  return (await reqToPromise((await store('readonly')).get(id))) || null;
}

export async function listThemes() {
  return reqToPromise((await store('readonly')).getAll());
}

export async function putTheme(record) {
  await reqToPromise((await store('readwrite')).put(record));
}

export async function deleteTheme(id) {
  await reqToPromise((await store('readwrite')).delete(id));
}
