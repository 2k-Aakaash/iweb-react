// Interface sounds a theme brings (tokens.json "sounds"): a short sound for windows opening,
// closing and minimising, and for notifications. iWeb itself has none, so nothing plays
// without a theme that has them, or with Settings → Appearance → Theme Sounds off.
//
// One AudioContext for all of them, created on the first sound (after the user has clicked
// or typed, as browsers require; a sound before that is skipped). Each sound is decoded once.
import { createStoredPref, toBoolean } from '../prefs/storedPref.js';
import { createOverrides } from './overrides.js';

export const SOUND_EVENTS = Object.freeze(['open', 'close', 'minimize', 'notification']);
const VOLUME = 0.6;

export const themeSoundsPref = createStoredPref({
  key: 'theme_sounds',
  mirrorKey: 'iweb:themeSounds',
  fallback: true,
  normalize: toBoolean,
});

/** event -> blob: URL of the active theme's sound (set by engine.js). */
export const themedSounds = createOverrides();

let ctx = null;
const buffers = new Map(); // url -> Promise<AudioBuffer | null>

function context() {
  if (ctx) return ctx;
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

function decode(url) {
  if (!buffers.has(url)) {
    buffers.set(url, fetch(url)
      .then((r) => r.arrayBuffer())
      .then((data) => context()?.decodeAudioData(data))
      .catch(() => null));
  }
  return buffers.get(url);
}

/** Forgets decoded sounds (the theme changed; its URLs are revoked). */
export function resetSounds() {
  buffers.clear();
}

/** Plays the theme's sound for `event`, if it has one and theme sounds are on. */
export function playUiSound(event) {
  const url = themedSounds.get(event);
  if (!url || !themeSoundsPref.get()) return;
  // Browsers only allow sound once the user has interacted with the page.
  if (typeof navigator !== 'undefined' && navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  const ac = context();
  if (!ac) return;
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  decode(url).then((buffer) => {
    if (!buffer || themedSounds.get(event) !== url) return;
    const source = ac.createBufferSource();
    const gain = ac.createGain();
    gain.gain.value = VOLUME;
    source.buffer = buffer;
    source.connect(gain).connect(ac.destination);
    source.start();
  });
}
