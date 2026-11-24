// The start-up reveal, like logging in on macOS 26: the desktop appears from behind a dark,
// blurred veil (#boot-veil in index.html, styled there so it covers the very first frame)
// that fades away quickly: the whole reveal takes about 0.3 s. While it's up, the page settles behind it: React's first render,
// the wallpaper, the glass, so none of that loading shows.
//
// The veil lifts once the app has rendered ('app'), the wallpaper is painted ('wallpaper') and
// the glass of the surfaces on screen at start (the Dock, the search bar, the menu bar) has
// rendered ('glass'), plus two frames; so the desktop is revealed with its glass already in
// place. It never waits longer than CAP_MS, so a slow wallpaper, storage or GPU can't hold up
// the desktop.

const CAP_MS = 600; // after the app's code starts
const pending = new Set(['app', 'wallpaper', 'glass']);
let revealed = false;

function reveal() {
  if (revealed) return;
  revealed = true;
  const veil = document.getElementById('boot-veil');
  if (!veil) return;
  veil.classList.add('is-gone');
  // Gone from the page once faded, so its blur costs nothing afterwards.
  const remove = () => veil.remove();
  veil.addEventListener('transitionend', remove, { once: true });
  setTimeout(remove, 500);
}

/** Has the start-up veil lifted (or begun to)? */
export const bootRevealed = () => revealed;

/** A part of the start-up is ready ('app', 'wallpaper', 'glass'); the last one lifts the veil. */
export function markBootReady(part) {
  if (revealed || !pending.delete(part) || pending.size) return;
  // Two frames for the glass surfaces to measure and paint behind the veil.
  requestAnimationFrame(() => requestAnimationFrame(reveal));
}

if (typeof window !== 'undefined') setTimeout(reveal, CAP_MS);
