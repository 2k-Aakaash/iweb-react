// Notifications, as in macOS 26: a banner at the top right for a few seconds, then kept in
// Notification Center (opened from the menu bar clock) until cleared. Kept in localStorage
// (the last 50, for a week), so every iWeb tab shows the same list.
//
//   notify({ app: 'timer', title: 'Timer', body: '5 min timer finished',
//            action: { event: 'controlcenter:open', detail: { view: 'timer' } }, key: 'timer' })
//
// `action` runs when the notification is clicked: an event to dispatch (it must survive a
// reload, so not a function). `key` replaces an earlier notification with the same key
// rather than adding another. While Focus is on (Control Center) no banner shows; the
// notification still goes to Notification Center, as in macOS.
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'iweb:notifications';
const MAX = 50;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export const BANNER_MS = 5000;

export const APPS = {
  timer: { name: 'Timer', icon: 'timer' },
  update: { name: 'Software Update', icon: 'update' },
  notes: { name: 'Notes', icon: 'notes' },
  dock: { name: 'Dock', icon: 'dock' },
  music: { name: 'Music', icon: 'music' },
  backup: { name: 'Backup', icon: 'backup' },
  iweb: { name: 'iWeb', icon: 'iweb' },
};

function normalize(list, now = Date.now()) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((n) => n && typeof n.id === 'string' && typeof n.title === 'string' && Number.isFinite(n.time) && now - n.time < MAX_AGE)
    .slice(0, MAX);
}

function read() {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
  } catch {
    return [];
  }
}

let state = { list: typeof localStorage === 'undefined' ? [] : read(), banner: null };
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

function setList(list, banner = state.banner) {
  state = { list, banner };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage blocked: this tab only.
  }
  emit();
}

let bannerTimer = 0;
let quiet = () => false; // Focus (set by the host: notifications.setQuiet)
export const setQuiet = (fn) => {
  quiet = fn;
};

/** Posts a notification; returns its id. */
export function notify({ app = 'iweb', title, body = '', action = null, key = null, banner = true, now = Date.now() }) {
  const id = `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const item = { id, app, title: String(title), body: String(body || ''), action, key, time: now };
  const rest = key ? state.list.filter((n) => n.key !== key) : state.list;
  const showBanner = banner && !quiet();
  setList([item, ...rest].slice(0, MAX), showBanner ? item : state.banner);
  if (showBanner) {
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => dismissBanner(id), BANNER_MS);
  }
  return id;
}

/** Posts it only the first time `key` is seen (an update notice, once per release). */
export function notifyOnce(key, options) {
  let seen;
  try {
    seen = JSON.parse(localStorage.getItem('iweb:notifiedKeys') || '[]');
  } catch {
    seen = [];
  }
  if (!Array.isArray(seen)) seen = [];
  if (seen.includes(key)) return null;
  try {
    localStorage.setItem('iweb:notifiedKeys', JSON.stringify([key, ...seen].slice(0, 100)));
  } catch {
    // Storage blocked: it may show again.
  }
  return notify({ ...options, key });
}

export function dismissBanner(id) {
  if (state.banner && (!id || state.banner.id === id)) {
    state = { ...state, banner: null };
    emit();
  }
}

/** Holds the banner on screen while the pointer is over it, then lets it go. */
export function holdBanner(hold) {
  clearTimeout(bannerTimer);
  if (!hold && state.banner) {
    const id = state.banner.id;
    bannerTimer = setTimeout(() => dismissBanner(id), 2000);
  }
}

export function removeNotification(id) {
  setList(state.list.filter((n) => n.id !== id), state.banner?.id === id ? null : state.banner);
}

export function clearApp(app) {
  setList(state.list.filter((n) => n.app !== app));
}

export function clearAll() {
  setList([], null);
}

/** Runs a notification's action (and removes it, as clicking one does in macOS). */
export function openNotification(n) {
  if (n.action?.event) window.dispatchEvent(new CustomEvent(n.action.event, { detail: n.action.detail }));
  removeNotification(n.id);
}

/** Notifications grouped by app, newest first: [{ app, items }]. */
export function groupByApp(list) {
  const groups = new Map();
  for (const n of list) {
    if (!groups.has(n.app)) groups.set(n.app, []);
    groups.get(n.app).push(n);
  }
  return [...groups].map(([app, items]) => ({ app, items }));
}

/** "now", "5m ago", "2h ago", "Yesterday", "Mon" — as macOS shows the time of a notification. */
export function timeAgo(time, now = Date.now()) {
  const s = Math.max(0, Math.round((now - time) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 172800) return 'Yesterday';
  return new Date(time).toLocaleDateString(undefined, { weekday: 'short' });
}

let storageAttached = false;
function subscribe(listener) {
  listeners.add(listener);
  if (!storageAttached && typeof window !== 'undefined') {
    storageAttached = true;
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY && e.key !== null) return;
      state = { ...state, list: read() };
      emit();
    });
  }
  return () => listeners.delete(listener);
}

const getState = () => state;
export function useNotifications() {
  return useSyncExternalStore(subscribe, getState, getState);
}

export function _resetNotifications() {
  clearTimeout(bannerTimer);
  state = { list: read(), banner: null };
}
