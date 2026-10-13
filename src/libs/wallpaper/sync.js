// Cross-tab and same-tab change signals for the wallpaper system.
// Messages are signals only: receivers re-read persistent state (IndexedDB / localStorage).

export const CHANNEL_NAME = 'iweb-wallpaper';

export const EVENT_TYPES = Object.freeze([
  'active-changed',
  'library-changed',
  'quota-changed',
  'settings-changed',
]);

// localStorage keys whose `storage` events are mapped to wallpaper signals.
const STORAGE_KEY_EVENTS = {
  wallpaperSettings: 'settings-changed',
  activeWallpaper: 'active-changed',
};

const handlers = new Set();
let channel = null;
let channelUnavailable = false;
let storageListenerAttached = false;

function isValidType(type) {
  return EVENT_TYPES.includes(type);
}

function dispatch(message) {
  // Copy first so a handler that unsubscribes during dispatch does not skip others.
  for (const handler of Array.from(handlers)) {
    try {
      handler(message);
    } catch (err) {
      console.error('[wallpaper sync] subscriber failed:', err);
    }
  }
}

function getChannel() {
  if (channel || channelUnavailable) return channel;
  if (typeof BroadcastChannel === 'undefined') {
    channelUnavailable = true;
    return null;
  }
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event) => {
      const data = event?.data;
      if (!data || typeof data !== 'object' || !isValidType(data.type)) return;
      dispatch({ type: data.type, payload: data.payload });
    };
    // Node (tests) keeps the event loop alive for an open channel; browsers have no unref.
    if (typeof channel.unref === 'function') channel.unref();
  } catch (err) {
    console.warn('[wallpaper sync] BroadcastChannel unavailable:', err);
    channel = null;
    channelUnavailable = true;
  }
  return channel;
}

function onStorage(event) {
  if (!event) return;
  // key === null means localStorage.clear() in another tab: everything may have changed.
  if (event.key === null) {
    dispatch({ type: 'settings-changed', payload: undefined });
    dispatch({ type: 'active-changed', payload: undefined });
    return;
  }
  const type = STORAGE_KEY_EVENTS[event.key];
  if (type) dispatch({ type, payload: undefined });
}

function attachStorageListener() {
  if (storageListenerAttached) return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  try {
    window.addEventListener('storage', onStorage);
    storageListenerAttached = true;
  } catch (err) {
    console.warn('[wallpaper sync] storage events unavailable:', err);
  }
}

function detachStorageListener() {
  if (!storageListenerAttached) return;
  try {
    window.removeEventListener('storage', onStorage);
  } catch {
    // window went away (page teardown); nothing left to detach from.
  }
  storageListenerAttached = false;
}

/**
 * Sends a signal to other tabs (BroadcastChannel) and synchronously to
 * subscribers in this tab (`{ type, payload, local: true }`).
 */
export function broadcast(type, payload) {
  if (!isValidType(type)) {
    throw new TypeError(`Unknown wallpaper event type: ${type}`);
  }
  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage(payload === undefined ? { type } : { type, payload });
    } catch (err) {
      // Non-cloneable payload or closed channel: retry as a bare signal.
      try {
        ch.postMessage({ type });
      } catch {
        console.warn('[wallpaper sync] could not post message:', err);
      }
    }
  }
  dispatch({ type, payload, local: true });
}

/**
 * Subscribes to wallpaper signals from this tab and other tabs.
 * Returns an unsubscribe function (safe to call more than once).
 */
export function subscribe(handler) {
  if (typeof handler !== 'function') {
    throw new TypeError('subscribe(handler) expects a function');
  }
  handlers.add(handler);
  getChannel();
  attachStorageListener();
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) detachStorageListener();
  };
}
