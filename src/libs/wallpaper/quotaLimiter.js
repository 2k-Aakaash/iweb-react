// Daily limit for new Unsplash acquisitions (3 per local calendar day).
//
// Invariant: acquisitions + live reservations <= DAILY_LIMIT for the current local day.
// Every operation runs as ONE readwrite IndexedDB transaction on `wallpaper_meta`
// (roll the date over -> drop expired reservations -> check / mutate), so concurrent
// tabs are serialized by IndexedDB and cannot exceed the limit. There are no timers:
// rollover and expiry are evaluated lazily on every read and write.

import { openIwebDB, STORES, txDone } from './db.js';
import { broadcast } from './sync.js';

// Dev-only override (VITE_UNSPLASH_DAILY_LIMIT in .env). Ignored in production builds,
// where import.meta.env.DEV is false, so the shipped limit is always 3.
function resolveDailyLimit() {
  const env = import.meta.env || {};
  const override = Number.parseInt(env.VITE_UNSPLASH_DAILY_LIMIT, 10);
  if (env.DEV && env.MODE !== 'test' && Number.isFinite(override) && override > 0) return override;
  return 3;
}

export const DAILY_LIMIT = resolveDailyLimit();
export const RESERVATION_TTL_MS = 120000;

const QUOTA_KEY = 'unsplash_quota';

export class QuotaError extends Error {
  constructor(message, { code = 'DAILY_LIMIT', resetsAt = null } = {}) {
    super(message);
    this.name = 'QuotaError';
    this.code = code;
    this.resetsAt = resetsAt;
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function localDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function nextLocalMidnight(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  // Constructing from calendar fields keeps this correct across DST changes.
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
}

function resolveNow(now) {
  return typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
}

function makeRequestId(now) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${now.toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function isValidId(value) {
  return typeof value === 'string' && value !== '';
}

// Rolls the stored state over to `now`'s local day and drops expired reservations.
function normalizeState(raw, now) {
  const date = localDateKey(new Date(now));
  if (!raw || typeof raw !== 'object' || raw.date !== date) {
    return { key: QUOTA_KEY, date, acquisitions: [], reservations: [] };
  }

  const acquisitions = Array.isArray(raw.acquisitions)
    ? raw.acquisitions.filter((a) => a && isValidId(a.requestId) && isValidId(a.photoId))
    : [];

  // A live reservation never has more than the TTL left; anything beyond that was
  // written under a clock that has since moved backwards and is treated as stale.
  const reservations = Array.isArray(raw.reservations)
    ? raw.reservations.filter((r) => r
      && isValidId(r.requestId)
      && typeof r.expiresAt === 'number'
      && r.expiresAt > now
      && r.expiresAt <= now + RESERVATION_TTL_MS)
    : [];

  return { key: QUOTA_KEY, date, acquisitions, reservations };
}

function toStatus(state, now) {
  const used = state.acquisitions.length;
  const reserved = state.reservations.length;
  return {
    date: state.date,
    used,
    reserved,
    remaining: Math.max(0, DAILY_LIMIT - used - reserved),
    limit: DAILY_LIMIT,
    resetsAt: nextLocalMidnight(new Date(now)),
  };
}

async function openMetaTransaction() {
  const db = await openIwebDB();
  try {
    return db.transaction(STORES.META, 'readwrite');
  } catch (err) {
    // The cached connection was closed (e.g. versionchange); reopen once.
    if (err?.name !== 'InvalidStateError') throw err;
  }
  const fresh = await openIwebDB();
  return fresh.transaction(STORES.META, 'readwrite');
}

/**
 * Runs `mutate(state)` inside a single readwrite transaction. The (rolled over,
 * purged) state is written back only if it changed. Errors thrown by `mutate`
 * are re-thrown after the cleanup has been committed.
 * Resolves to { result, wrote, state }.
 */
async function runQuotaTransaction(now, mutate) {
  const tx = await openMetaTransaction();
  const done = txDone(tx);
  const store = tx.objectStore(STORES.META);

  let result;
  let failure = null;
  let wrote = false;
  let finalState = null;

  const getReq = store.get(QUOTA_KEY);
  getReq.onsuccess = () => {
    const original = getReq.result;
    const state = normalizeState(original, now);
    try {
      result = mutate(state);
    } catch (err) {
      failure = err;
    }
    finalState = state;
    if (JSON.stringify(original ?? null) !== JSON.stringify(state)) {
      store.put(state);
      wrote = true;
    }
  };

  await done;
  if (failure) throw failure;
  return { result, wrote, state: finalState };
}

export async function getQuotaStatus({ now } = {}) {
  const t = resolveNow(now);
  const { state } = await runQuotaTransaction(t, () => undefined);
  return toStatus(state, t);
}

export async function reserveSlot({ requestId, now } = {}) {
  const t = resolveNow(now);
  const id = isValidId(requestId) ? requestId : makeRequestId(t);

  const { wrote } = await runQuotaTransaction(t, (state) => {
    const existing = state.reservations.find((r) => r.requestId === id);
    if (existing) {
      // Idempotent: refresh the lease instead of taking a second slot.
      existing.expiresAt = t + RESERVATION_TTL_MS;
      return;
    }
    // Already committed under this id: the slot is consumed, nothing to reserve.
    if (state.acquisitions.some((a) => a.requestId === id)) return;

    if (state.acquisitions.length + state.reservations.length >= DAILY_LIMIT) {
      throw new QuotaError(
        `Daily limit of ${DAILY_LIMIT} new wallpapers reached.`,
        { code: 'DAILY_LIMIT', resetsAt: nextLocalMidnight(new Date(t)) },
      );
    }
    state.reservations.push({ requestId: id, at: t, expiresAt: t + RESERVATION_TTL_MS });
  });

  if (wrote) broadcast('quota-changed');
  return { requestId: id };
}

export async function commitSlot(requestId, photoId, { now } = {}) {
  if (!isValidId(requestId)) throw new TypeError('commitSlot requires a requestId');
  if (!isValidId(photoId)) throw new TypeError('commitSlot requires a photoId');
  const t = resolveNow(now);

  const { result, wrote } = await runQuotaTransaction(t, (state) => {
    const dropReservation = () => {
      state.reservations = state.reservations.filter((r) => r.requestId !== requestId);
    };

    // Replay of an earlier commit for this request.
    if (state.acquisitions.some((a) => a.requestId === requestId)) {
      dropReservation();
      return { counted: true };
    }
    // Same photo already counted today: never count it twice.
    if (state.acquisitions.some((a) => a.photoId === photoId)) {
      dropReservation();
      return { counted: false };
    }

    const hadReservation = state.reservations.some((r) => r.requestId === requestId);
    dropReservation();
    // Without a live reservation (expired, or crossed midnight) the acquisition is
    // only counted if there is room, so the invariant is never violated.
    if (!hadReservation && state.acquisitions.length + state.reservations.length >= DAILY_LIMIT) {
      return { counted: false };
    }
    state.acquisitions.push({ requestId, photoId, at: t });
    return { counted: true };
  });

  if (wrote) broadcast('quota-changed');
  return result;
}

export async function releaseSlot(requestId, { now } = {}) {
  if (!isValidId(requestId)) return;
  const t = resolveNow(now);
  const { wrote } = await runQuotaTransaction(t, (state) => {
    state.reservations = state.reservations.filter((r) => r.requestId !== requestId);
  });
  if (wrote) broadcast('quota-changed');
}
