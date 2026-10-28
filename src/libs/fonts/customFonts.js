// Custom clock fonts the user uploaded: iWebDB `custom_fonts`, { family, name, blob } keyed by
// family. App.jsx registers them with document.fonts at start-up; Settings → General lists them.
import { openIwebDB, reqToPromise, STORES, txDone } from '../wallpaper/db.js';

export async function listCustomFonts() {
  const db = await openIwebDB();
  if (!db.objectStoreNames.contains(STORES.FONTS)) return [];
  const tx = db.transaction(STORES.FONTS, 'readonly');
  return (await reqToPromise(tx.objectStore(STORES.FONTS).getAll())) || [];
}

/**
 * Deletes fonts by family, from iWebDB and from the page's registered faces (so the deleted
 * font stops rendering right away). Returns the families that were deleted.
 */
export async function deleteCustomFonts(families) {
  const unique = [...new Set(families)].filter((family) => typeof family === 'string' && family);
  if (unique.length === 0) return [];
  const db = await openIwebDB();
  const tx = db.transaction(STORES.FONTS, 'readwrite');
  const store = tx.objectStore(STORES.FONTS);
  unique.forEach((family) => store.delete(family));
  await txDone(tx);
  unregisterFontFaces(unique);
  return unique;
}

function unregisterFontFaces(families) {
  if (typeof document === 'undefined' || !document.fonts) return;
  const names = new Set(families);
  for (const face of [...document.fonts]) {
    if (names.has(face.family.replace(/^["']|["']$/g, ''))) document.fonts.delete(face);
  }
}
