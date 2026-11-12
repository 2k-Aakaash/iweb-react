// Atmosphere suggestions: a scene to match the wallpaper, or the time of day. Suggestions only
// suggest: they're a notification (the existing banner and Notification Center), and only a
// click on one applies the scene, so nothing ever starts playing on its own. Everything is
// local: no network, no image analysis.
//
//   wallpaper  When the wallpaper changes in this tab: the scene linked to that wallpaper (the
//              user's own choice, in Atmosphere → Experience), or else one matched from the
//              wallpaper's own words (an Unsplash photo's topic, search and description, or a
//              local file's name). On by default, but only once Atmosphere has been played: it
//              never advertises itself to someone who hasn't used it.
//   time       Opt-in. Once per part of the day (morning, afternoon, evening, night), checked
//              when iWeb comes back into view and at the next boundary, never by polling.
//
// Each wallpaper and scene pair, and each part of each day, is suggested at most once.
import { tokenizeKeywords } from '../wallpaper/repository.js';
import { builtInScene, findScene } from './scenes.js';

const LOG_KEY = 'iweb:ambienceSuggested';
const USED_KEY = 'iweb:ambienceUsed';
const LOG_MAX = 80;

/** The key a wallpaper is linked by: 'local:12' or 'unsplash:abc'. */
export const wallpaperKey = (ref) => (ref && (ref.source === 'local' || ref.source === 'unsplash') ? `${ref.source}:${ref.id}` : null);

// Words to scenes. More matches win; a tie goes to the earlier scene. Rain counts double: it's
// the strongest sound in a picture, so a rainy city at night is Rainy Reading.
const WORDS = [
  ['rainy-reading', ['rain', 'rainy', 'raindrops', 'storm', 'stormy', 'drizzle', 'wet', 'umbrella', 'fog', 'foggy', 'mist', 'misty', 'thunder', 'monsoon', 'overcast']],
  ['forest-escape', ['forest', 'forests', 'tree', 'trees', 'woods', 'woodland', 'jungle', 'rainforest', 'leaf', 'leaves', 'moss', 'fern', 'pine', 'meadow', 'nature', 'greenery', 'valley', 'grove']],
  ['ocean-meditation', ['ocean', 'sea', 'seascape', 'beach', 'wave', 'waves', 'coast', 'coastal', 'shore', 'surf', 'lagoon', 'underwater', 'bay', 'tide', 'reef']],
  ['deep-focus', ['galaxy', 'space', 'stars', 'star', 'starry', 'milky', 'nebula', 'cosmos', 'cosmic', 'astronomy', 'astrophotography', 'aurora', 'planet', 'universe']],
  ['midnight-coding', ['sunset', 'sunrise', 'dusk', 'dawn', 'twilight', 'pastel', 'dream', 'dreamy', 'clouds', 'cloud', 'lavender', 'purple', 'pink']],
  ['fireside', ['fire', 'fireplace', 'campfire', 'cabin', 'cozy', 'cosy', 'candle', 'candles', 'snow', 'snowy', 'winter', 'hearth']],
  ['late-night', ['night', 'city', 'neon', 'skyline', 'urban', 'lights', 'nightscape', 'midnight', 'moon', 'dark']],
];

/** The words a wallpaper record carries (Unsplash metadata, or a local file's name). */
export function wallpaperWords(record) {
  if (!record) return [];
  const parts = [record.name, record.description, record.alt_description, record.altDescription, record.topic, record.query];
  const words = new Set();
  for (const p of parts) for (const t of tokenizeKeywords(typeof p === 'string' ? p : '')) words.add(t);
  for (const list of [record.keywords, record.tags]) {
    if (Array.isArray(list)) for (const k of list) for (const t of tokenizeKeywords(typeof k === 'string' ? k : k?.title || '')) words.add(t);
  }
  return [...words];
}

/** The built-in scene whose words best match, or null when nothing does. */
export function sceneForWords(words) {
  const set = new Set(words);
  let best = null;
  let bestScore = 0;
  for (const [sceneId, list] of WORDS) {
    const weight = sceneId === 'rainy-reading' ? 2 : 1;
    const score = list.reduce((n, w) => n + (set.has(w) ? weight : 0), 0);
    if (score > bestScore) {
      best = sceneId;
      bestScore = score;
    }
  }
  return best;
}

// ---- time of day -----------------------------------------------------------------------

export const TIME_SLOTS = {
  morning: { from: 5, label: 'this morning', greeting: 'Good morning', scene: 'forest-escape' }, // bright, gentle
  afternoon: { from: 12, label: 'this afternoon', greeting: 'Good afternoon', scene: 'deep-focus' }, // neutral, focused
  evening: { from: 17, label: 'this evening', greeting: 'Good evening', scene: 'rainy-reading' }, // warm, relaxed
  night: { from: 21, label: 'tonight', greeting: 'Late night', scene: 'late-night' }, // deep, slow, minimal
};

/** The part of the day at `date` (local time). */
export function timeSlot(date = new Date()) {
  const h = date.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

/** The scene suggested for the part of the day at `date`. */
export const sceneForTime = (date = new Date()) => builtInScene(TIME_SLOTS[timeSlot(date)].scene);

/** Milliseconds until the next part of the day begins. */
export function msToNextSlot(date = new Date()) {
  const next = new Date(date);
  const h = date.getHours();
  const bounds = [5, 12, 17, 21];
  const after = bounds.find((b) => b > h);
  if (after === undefined) {
    next.setDate(next.getDate() + 1);
    next.setHours(5, 0, 0, 0);
  } else {
    next.setHours(after, 0, 0, 0);
  }
  return Math.max(60000, next - date);
}

const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

// ---- the suggestion log ----------------------------------------------------------------

function makeLog(storage) {
  const read = () => {
    try {
      const v = JSON.parse(storage?.getItem(LOG_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  return {
    has: (key) => read().includes(key),
    add: (key) => {
      try {
        storage?.setItem(LOG_KEY, JSON.stringify([key, ...read().filter((k) => k !== key)].slice(0, LOG_MAX)));
      } catch {
        // Storage blocked: it may be suggested again.
      }
    },
  };
}

/**
 * Decides what to suggest. Pure apart from the log and the record lookup, so it's testable:
 * returns { sceneId, title, body, key } or null.
 */
export async function wallpaperSuggestion({ ref, state, customScenes = [], getRecord, log }) {
  if (!state.suggest?.wallpaper || state.focus?.status === 'running') return null;
  const key = wallpaperKey(ref);
  if (!key) return null;
  let sceneId = state.links?.[key] || null;
  if (!sceneId && getRecord) {
    const record = await getRecord(ref).catch(() => null);
    sceneId = sceneForWords(wallpaperWords(record));
  }
  const scene = findScene(sceneId, customScenes);
  if (!scene) return null;
  if (state.sceneId === scene.id && state.session) return null; // already there
  const logKey = `w|${key}|${scene.id}`;
  if (log.has(logKey)) return null;
  log.add(logKey);
  const playing = state.status === 'playing';
  return {
    sceneId: scene.id,
    title: 'Match your atmosphere?',
    body: `Your wallpaper changed. ${playing ? 'Switch to' : 'Play'} ${scene.name}?`,
    key: logKey,
  };
}

export function timeSuggestion({ state, date = new Date(), log }) {
  if (!state.suggest?.time || state.focus?.status === 'running') return null;
  const slot = timeSlot(date);
  const info = TIME_SLOTS[slot];
  const logKey = `t|${dayKey(date)}|${slot}`;
  if (log.has(logKey)) return null;
  log.add(logKey);
  const scene = builtInScene(info.scene);
  if (state.sceneId === scene.id && state.status === 'playing') return null;
  const playing = state.status === 'playing';
  return {
    sceneId: scene.id,
    title: info.greeting,
    body: `${scene.name} suits ${info.label}. ${playing ? 'Switch to it?' : 'Play it?'}`,
    key: logKey,
  };
}

// ---- running it ------------------------------------------------------------------------

/**
 * Starts listening (once per page; App.jsx). `deps` are injected so this module stays light
 * and testable: { engine, notify, subscribeWallpaper, getRecord, customScenes, sceneEvent,
 * storage, now, timers }. Returns a stop function.
 */
export function startSuggestions({
  engine,
  notify,
  subscribeWallpaper,
  getRecord,
  customScenes = () => [],
  sceneEvent,
  storage = typeof localStorage === 'undefined' ? null : localStorage,
  now = () => new Date(),
  timers = { setTimeout: (...a) => globalThis.setTimeout(...a), clearTimeout: (...a) => globalThis.clearTimeout(...a) },
}) {
  const log = makeLog(storage);
  const used = () => {
    try {
      return storage?.getItem(USED_KEY) === '1';
    } catch {
      return false;
    }
  };
  const post = (s) => {
    if (!s) return;
    notify({ app: 'atmosphere', title: s.title, body: s.body, action: { event: sceneEvent, detail: { sceneId: s.sceneId } }, key: 'atmosphere-suggest' });
  };

  // Remember that Atmosphere has been played (wallpaper suggestions wait for that).
  let lastTime = engine.getState().suggest?.time;
  let slotTimer = 0;
  const offEngine = engine.subscribe(() => {
    const st = engine.getState();
    if (st.status === 'playing' && !used()) {
      try { storage?.setItem(USED_KEY, '1'); } catch { /* blocked */ }
    }
    if (st.suggest?.time !== lastTime) {
      lastTime = st.suggest?.time;
      if (lastTime) {
        checkTime(); // switched on: the suggestion for now, then the next part of the day
        armTime();
      } else {
        timers.clearTimeout(slotTimer);
      }
    }
  });

  const checkTime = () => post(timeSuggestion({ state: engine.getState(), date: now(), log }));
  function armTime() {
    timers.clearTimeout(slotTimer);
    if (!engine.getState().suggest?.time) return;
    // At the next part of the day (a single timer; no polling). A few seconds in, so the hour
    // has turned.
    slotTimer = timers.setTimeout(() => {
      checkTime();
      armTime();
    }, msToNextSlot(now()) + 5000);
  }

  const onVisible = () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    checkTime();
    armTime();
  };

  const offWallpaper = subscribeWallpaper?.((msg) => {
    // Only a change made in this tab (each tab would otherwise suggest it too).
    if (msg?.type !== 'active-changed' || !msg.local || !msg.payload || !used()) return;
    wallpaperSuggestion({ ref: msg.payload, state: engine.getState(), customScenes: customScenes(), getRecord, log })
      .then(post)
      .catch(() => {});
  });

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  if (lastTime) {
    checkTime();
    armTime();
  }

  return () => {
    offEngine();
    offWallpaper?.();
    timers.clearTimeout(slotTimer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  };
}
