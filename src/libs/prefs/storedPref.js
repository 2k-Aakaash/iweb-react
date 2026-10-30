// A small setting saved in iWebDB (the `wallpaper_meta` store, one { key, value } row), such as
// the clock style or the Control Center's toggles. Backups include every one (allPrefs).
//
// IndexedDB answers asynchronously, so each setting also keeps a copy in localStorage to be
// right on the first frame; the copy tells other tabs about a change too. iWebDB wins when
// they differ. A setting changed many times in a row (a slider) is written to iWebDB once it
// settles (`debounceMs`).
import { useSyncExternalStore } from 'react';
import { openIwebDB, reqToPromise, STORES } from '../wallpaper/db.js';

const registry = new Map(); // key -> pref

/** Every setting kept this way, by key (for backups). */
export const allPrefs = () => registry;

/**
 * @param {object} o
 * @param {string} o.key        the iWebDB row
 * @param {string} o.mirrorKey  the localStorage copy
 * @param {*} o.fallback        the value until one is chosen
 * @param {(v: *) => *} o.normalize  a valid value from anything, or null
 * @param {number} [o.debounceMs]
 */
export function createStoredPref({ key, mirrorKey, fallback, normalize, debounceMs = 0 }) {
  const readMirror = () => {
    let raw;
    try {
      raw = localStorage.getItem(mirrorKey);
    } catch {
      return null;
    }
    if (raw === null) return null;
    try {
      return normalize(JSON.parse(raw));
    } catch {
      return normalize(raw); // a plain string, as copies were once written
    }
  };
  const writeMirror = (value) => {
    try {
      localStorage.setItem(mirrorKey, JSON.stringify(value));
    } catch {
      // Storage blocked: iWebDB still has it.
    }
  };

  let value = readMirror() ?? fallback;
  const listeners = new Set();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  const apply = (next) => {
    if (Object.is(next, value) || JSON.stringify(next) === JSON.stringify(value)) return;
    value = next;
    writeMirror(next);
    emit();
  };

  async function getStored() {
    const db = await openIwebDB();
    const row = await reqToPromise(db.transaction(STORES.META, 'readonly').objectStore(STORES.META).get(key));
    return row === undefined ? null : normalize(row.value);
  }

  async function store(next) {
    const db = await openIwebDB();
    await reqToPromise(db.transaction(STORES.META, 'readwrite').objectStore(STORES.META).put({ key, value: next }));
  }

  let timer = 0;
  let pending = null;
  const save = (next) => {
    const write = () => store(next).catch((err) => console.warn(`[prefs] Could not save ${key}:`, err));
    if (!debounceMs) return write();
    clearTimeout(timer);
    pending = new Promise((resolve) => {
      timer = setTimeout(() => write().then(resolve), debounceMs);
    });
    return pending;
  };

  /** Shows the value at once and saves it to iWebDB (resolves once saved). */
  async function set(next) {
    const valid = normalize(typeof next === 'function' ? next(value) : next);
    if (valid === null) return;
    apply(valid);
    await save(valid);
  }

  // Once per page: take the saved value from iWebDB, or save the current one there.
  let loading = null;
  function load() {
    if (!loading) {
      loading = getStored()
        .then((saved) => (saved !== null ? apply(saved) : store(value)))
        .catch((err) => console.warn(`[prefs] Could not read ${key}:`, err));
    }
    return loading;
  }

  let storageAttached = false;
  function subscribe(listener) {
    listeners.add(listener);
    load();
    if (!storageAttached && typeof window !== 'undefined') {
      storageAttached = true;
      window.addEventListener('storage', (e) => {
        if (e.key !== mirrorKey && e.key !== null) return;
        const next = readMirror();
        if (next !== null && JSON.stringify(next) !== JSON.stringify(value)) {
          value = next;
          emit();
        }
      });
    }
    return () => listeners.delete(listener);
  }

  const get = () => value;
  const pref = {
    key,
    get,
    set,
    load,
    getStored,
    subscribe,
    /** For tests: forget the loaded state. */
    _reset() {
      clearTimeout(timer);
      value = readMirror() ?? fallback;
      loading = null;
    },
  };
  registry.set(key, pref);
  return pref;
}

/** The current value of a pref, re-rendering when it changes. */
export function usePref(pref) {
  return useSyncExternalStore(pref.subscribe, pref.get, pref.get);
}

/** A pref that is true or false. */
export const toBoolean = (v) => (typeof v === 'boolean' ? v : null);
