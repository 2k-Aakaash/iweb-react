// Shared state of the Creator widgets: the accounts, their latest data, refresh status and
// snapshots. One source of truth for both widgets and Settings → Widgets; cache first.
//
// Refreshing (refreshAccount):
//   - one refresh per account at a time: in this tab (the promise is shared) and across tabs
//     (a Web Lock per account; a tab that waited re-reads what the other stored instead of
//     asking again)
//   - a failure keeps the stored data and records the error; automatic retries back off
//     (1, 2, 5, 15, 60 min, or what the server's Retry-After says) and stop entirely for
//     errors the person has to fix (reconnect, allow access)
//   - each success stores a snapshot of the lifetime counters (snapshots.js)
// Scheduling: one timer per account, only while a widget showing it is on screen and the
// tab is visible, at the interval chosen in Settings (creatorPrefs.js). Nothing runs for
// accounts no widget shows. Grants never leave this module except to iWeb's own API.
import { CreatorError, NEEDS_ACTION, fetchOwnerData, getConfig, lookupChannel, revokeGrant } from './creatorApi.js';
import { signIn } from './creatorAuth.js';
import { addSnapshot, deleteAccount, readAccount, readAccounts, readSnapshots, writeAccount } from './creatorDb.js';
import { creatorPrefs, refreshIntervalMs } from './creatorPrefs.js';
import { snapshotOf } from './snapshots.js';

const CHANNEL = 'iweb-creator';
const BACKOFF_MS = [60e3, 2 * 60e3, 5 * 60e3, 15 * 60e3, 60 * 60e3];
const MANUAL_GAP_MS = 15 * 1000; // a manual refresh right after another is answered from cache
const FIRST_LOOK_DELAY_MS = 400; // let the cached numbers paint before refreshing

let state = { ready: false, accounts: {}, refreshing: {}, snapshots: {}, config: null };
const grants = new Map(); // account id → sealed grant (never in `state`, never in the UI)
const listeners = new Set();
const inflight = new Map(); // account id → promise
const watchers = new Map(); // account id → count of widgets showing it
const timers = new Map(); // account id → timeout
let hydrating = null;
let channel = null;
let configLoading = null;
let lifecycleAttached = false;

function emit() {
  for (const listener of [...listeners]) listener();
}

function set(patch) {
  state = { ...state, ...patch };
  emit();
}

// What the UI sees of an account: everything but the grant.
function viewOf(record) {
  const { grant, ...rest } = record;
  return { ...rest, connected: Boolean(grant) };
}

function putRecord(record) {
  if (record.grant) grants.set(record.id, record.grant);
  else grants.delete(record.id);
  set({ accounts: { ...state.accounts, [record.id]: viewOf(record) } });
}

function dropRecord(id) {
  grants.delete(id);
  const accounts = { ...state.accounts };
  const snapshots = { ...state.snapshots };
  delete accounts[id];
  delete snapshots[id];
  set({ accounts, snapshots });
}

const recordOf = (id) => {
  const view = state.accounts[id];
  if (!view) return null;
  const record = { ...view, ...(grants.has(id) ? { grant: grants.get(id) } : null) };
  delete record.connected;
  return record;
};

// ---- subscription, hydration, cross-tab ----------------------------------------------------

export function subscribe(listener) {
  listeners.add(listener);
  hydrate();
  attachLifecycle();
  return () => listeners.delete(listener);
}

export const getState = () => state;

export function hydrate() {
  if (!hydrating) {
    hydrating = readAccounts()
      .then((records) => {
        const accounts = {};
        for (const record of records) {
          if (record.grant) grants.set(record.id, record.grant);
          accounts[record.id] = viewOf(record);
        }
        set({ ready: true, accounts: { ...accounts, ...state.accounts } });
        for (const id of watchers.keys()) schedule(id, { firstLook: true });
      })
      .catch((err) => {
        console.warn('[creator] Could not read accounts:', err?.name || err);
        set({ ready: true });
      });
  }
  return hydrating;
}

function broadcast(message) {
  try {
    channel?.postMessage(message);
  } catch {
    // channel closed
  }
}

async function adoptStored(id) {
  const record = await readAccount(id).catch(() => null);
  if (record) putRecord(record);
  else dropRecord(id);
  if (state.snapshots[id]) loadSnapshots(id, { force: true });
  schedule(id);
}

function attachLifecycle() {
  if (lifecycleAttached || typeof window === 'undefined') return;
  lifecycleAttached = true;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (e) => {
        const { type, id } = e.data || {};
        if (type === 'account' && typeof id === 'string') adoptStored(id);
      };
    } catch {
      channel = null;
    }
  }
  // Hidden tabs do nothing; coming back refreshes what is due.
  document.addEventListener('visibilitychange', () => {
    for (const id of watchers.keys()) schedule(id, { firstLook: true });
  });
  window.addEventListener('online', () => {
    for (const id of watchers.keys()) schedule(id, { firstLook: true });
  });
  // A new refresh interval applies at once.
  creatorPrefs.subscribe(() => {
    for (const id of watchers.keys()) schedule(id);
  });
}

// ---- server config ---------------------------------------------------------------------------

/** What this iWeb server supports (cached for the page). */
export function loadConfig({ force = false } = {}) {
  if (!configLoading || force) {
    configLoading = getConfig()
      .then((config) => set({ config: { ...config, error: null } }))
      .catch((err) => {
        set({ config: { youtube: { lookup: false, connect: false }, instagram: { connect: false }, error: { code: err.code || 'NETWORK', message: err.message } } });
        configLoading = null; // ask again next time
      });
  }
  return configLoading;
}

// ---- snapshots -------------------------------------------------------------------------------

export function loadSnapshots(id, { force = false } = {}) {
  if (state.snapshots[id] && !force) return Promise.resolve(state.snapshots[id]);
  return readSnapshots(id)
    .then((list) => {
      if (state.accounts[id]) set({ snapshots: { ...state.snapshots, [id]: list } });
      return list;
    })
    .catch(() => []);
}

async function recordSnapshot(id, data) {
  const snapshot = snapshotOf(id, data);
  if (!snapshot) return;
  const kept = await addSnapshot(snapshot).catch(() => null);
  if (kept && state.snapshots[id]) set({ snapshots: { ...state.snapshots, [id]: kept } });
}

// ---- refresh ---------------------------------------------------------------------------------

const intervalOf = () => refreshIntervalMs();

/** When the account should refresh next on its own (Infinity: not until asked). */
export function nextDue(record, interval = intervalOf()) {
  if (!record) return Infinity;
  if (record.error && NEEDS_ACTION.has(record.error.code)) return Infinity;
  if (record.error && Number.isFinite(record.retryAt)) return record.retryAt;
  if (!record.fetchedAt) return 0;
  return interval > 0 ? record.fetchedAt + interval : Infinity;
}

const withLock = (id, fn) => (typeof navigator !== 'undefined' && navigator.locks
  ? navigator.locks.request(`iweb-creator:${id}`, fn)
  : fn());

async function fetchFresh(record, signal) {
  if (record.mode === 'owner') {
    if (!record.grant) throw new CreatorError('REVOKED', 'This account isn’t connected. Connect it again.');
    return fetchOwnerData({ platform: record.platform, grant: record.grant, currency: record.currency }, { signal });
  }
  return { data: await lookupChannel(record.ref, { signal }) };
}

/**
 * Refreshes an account (manual when `force`). Resolves when done; never rejects: errors are
 * recorded on the account and its data is kept.
 */
export function refreshAccount(id, { force = false, immediate = false } = {}) {
  if (inflight.has(id)) return inflight.get(id);
  const run = withLock(id, async () => {
    // Another tab may have refreshed while this one waited for the lock.
    const stored = (await readAccount(id).catch(() => null)) || recordOf(id);
    if (!stored) return;
    if (stored.fetchedAt !== state.accounts[id]?.fetchedAt) putRecord(stored);
    const now = Date.now();
    if (!immediate && (force ? now - (stored.fetchedAt || 0) < MANUAL_GAP_MS && !stored.error : nextDue(stored) > now)) return;

    set({ refreshing: { ...state.refreshing, [id]: true } });
    let next;
    try {
      const result = await fetchFresh(stored);
      const data = result.data;
      next = {
        ...stored,
        ...(result.grant ? { grant: result.grant } : null),
        profile: { ...stored.profile, ...data.profile },
        data,
        fetchedAt: data.fetchedAt || now,
        error: null,
        failures: 0,
        retryAt: null,
      };
    } catch (err) {
      const code = err instanceof CreatorError ? err.code : 'UPSTREAM';
      const failures = (stored.failures || 0) + 1;
      const wait = err?.retryAfter || BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1];
      next = {
        ...stored,
        error: { code, message: err?.message || 'Couldn’t refresh.', at: Date.now() },
        failures,
        retryAt: NEEDS_ACTION.has(code) ? null : Date.now() + wait,
      };
    }
    // Removed while refreshing: don't bring it back.
    if (!state.accounts[id]) return;
    await writeAccount(next).catch((err) => console.warn('[creator] Could not save account:', err?.name || err));
    putRecord(next);
    if (!next.error) await recordSnapshot(id, next.data);
    broadcast({ type: 'account', id });
  }).finally(() => {
    inflight.delete(id);
    const refreshing = { ...state.refreshing };
    delete refreshing[id];
    set({ refreshing });
    schedule(id);
  });
  inflight.set(id, run);
  return run;
}

function schedule(id, { firstLook = false } = {}) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (!watchers.get(id) || !state.ready) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const due = nextDue(recordOf(id));
  if (!Number.isFinite(due)) return;
  const wait = Math.max(firstLook ? FIRST_LOOK_DELAY_MS : 1000, due - Date.now());
  // setTimeout can't wait longer than ~24.8 days; re-check before then.
  timers.set(id, setTimeout(() => refreshAccount(id), Math.min(wait, 2 ** 31 - 1)));
}

/** A widget shows this account: keep it fresh while it does. Returns the stop function. */
export function watchAccount(id) {
  watchers.set(id, (watchers.get(id) || 0) + 1);
  hydrate().then(() => schedule(id, { firstLook: true }));
  return () => {
    const count = (watchers.get(id) || 1) - 1;
    if (count > 0) {
      watchers.set(id, count);
      return;
    }
    watchers.delete(id);
    clearTimeout(timers.get(id));
    timers.delete(id);
  };
}

// ---- adding and removing ---------------------------------------------------------------------

async function store(record) {
  await writeAccount(record);
  putRecord(record);
  await recordSnapshot(record.id, record.data);
  broadcast({ type: 'account', id: record.id });
  return record.id;
}

/** Adds a public YouTube channel (@handle, ID or link). Resolves to its account id. */
export async function addPublicChannel(input) {
  await hydrate();
  const data = await lookupChannel(input);
  const id = `youtube:${data.profile.id}`;
  const existing = recordOf(id);
  // Already connected as its owner: that has everything public lookup has, and more.
  if (existing?.mode === 'owner') return id;
  return store({
    id,
    platform: 'youtube',
    ref: data.profile.id,
    mode: 'public',
    profile: data.profile,
    scopes: {},
    data,
    fetchedAt: data.fetchedAt,
    error: null,
    failures: 0,
    retryAt: null,
    addedAt: existing?.addedAt || Date.now(),
  });
}

/**
 * Connects an account through the provider's sign-in. `revenue` (YouTube) also asks for
 * revenue reports. Resolves to its account id; rejects with CreatorError (CANCELLED…).
 */
export async function connectAccount(platform, { revenue = false, currency, signal } = {}) {
  await hydrate();
  const { account, grant, data } = await signIn(platform, { revenue, currency, signal });
  const id = `${platform}:${account.ref}`;
  const existing = recordOf(id);
  return store({
    id,
    platform,
    ref: account.ref,
    mode: 'owner',
    profile: account.profile,
    scopes: account.scopes,
    currency: currency || existing?.currency || null,
    grant,
    data,
    fetchedAt: data.fetchedAt,
    error: null,
    failures: 0,
    retryAt: null,
    addedAt: existing?.addedAt || Date.now(),
  });
}

/**
 * Removes an account and everything stored for it on this device. A Google grant is also
 * revoked with Google; Instagram has no revoke API, so `{ manual: true }` asks the person to
 * remove iWeb in Instagram's settings.
 */
export async function removeAccount(id) {
  const record = recordOf(id);
  if (!record) return { manual: false };
  let manual = false;
  if (record.grant) {
    try {
      const result = await revokeGrant({ platform: record.platform, grant: record.grant });
      manual = Boolean(result?.manual);
    } catch {
      manual = record.platform === 'instagram';
    }
  }
  clearTimeout(timers.get(id));
  timers.delete(id);
  await deleteAccount(id);
  dropRecord(id);
  broadcast({ type: 'account', id });
  const prefs = creatorPrefs.get();
  if (prefs[record.platform] === id) creatorPrefs.set({ ...prefs, [record.platform]: null });
  return { manual };
}

/** Revenue currency of a YouTube owner account; refreshes it in that currency. */
export async function setAccountCurrency(id, currency) {
  const record = recordOf(id);
  if (!record || !/^[A-Z]{3}$/.test(currency)) return;
  const next = { ...record, currency };
  await writeAccount(next);
  putRecord(next);
  broadcast({ type: 'account', id });
  await refreshAccount(id, { immediate: true });
}

/** Accounts of a platform, oldest first. */
export function accountsOf(snapshot, platform) {
  return Object.values(snapshot.accounts).filter((a) => a.platform === platform).sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
}

/** For tests: forget everything in memory. */
export function _resetCreatorStore() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  watchers.clear();
  inflight.clear();
  grants.clear();
  hydrating = null;
  configLoading = null;
  state = { ready: false, accounts: {}, refreshing: {}, snapshots: {}, config: null };
}
