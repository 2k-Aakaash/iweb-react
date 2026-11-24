// The clock's chosen font, in place from the clock's first appearance: no default font first
// and then a swap. main.jsx calls startClockFont() before React renders. It loads just the
// chosen font (an uploaded one straight from iWebDB, a built-in one from its @font-face) and
// keeps the digits hidden (html.clock-font-pending, desktop.css) until it's ready, or until
// LIMIT_MS have passed so a missing or slow font can never keep the clock away.
import { openIwebDB, reqToPromise, STORES } from '../wallpaper/db.js';

const LIMIT_MS = 1200;
const PENDING = 'clock-font-pending';

/** The font chosen for the clock (Settings → General), or '' for the default. */
export function storedClockFont() {
  try {
    return localStorage.getItem('selectedFont') || '';
  } catch {
    return '';
  }
}

const unquote = (s) => s.replace(/^["']|["']$/g, '');

/** Is a face for this family already registered on the page? */
export const hasFontFace = (family) => [...(document.fonts || [])].some((f) => unquote(f.family) === family);

async function loadChosen(family) {
  // An uploaded font: read only this one record and register it.
  const db = await openIwebDB();
  if (db.objectStoreNames.contains(STORES.FONTS)) {
    const record = await reqToPromise(db.transaction(STORES.FONTS, 'readonly').objectStore(STORES.FONTS).get(family));
    if (record?.blob) {
      if (!hasFontFace(family)) {
        const face = new FontFace(record.family, await record.blob.arrayBuffer());
        await face.load();
        document.fonts.add(face);
      }
      return;
    }
  }
  // A built-in font (fonts.css): ask for it now, not when the clock happens to paint.
  await document.fonts.load(`64px "${family}"`);
}

export function startClockFont() {
  const family = storedClockFont();
  if (!family || typeof document === 'undefined' || !document.fonts) return;
  const root = document.documentElement;
  root.classList.add(PENDING);
  const done = () => root.classList.remove(PENDING);
  Promise.race([
    loadChosen(family).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, LIMIT_MS)),
  ]).then(done, done);
}
