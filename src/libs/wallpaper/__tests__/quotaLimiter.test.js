import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetIwebDBConnection } from '../db.js';
import {
  DAILY_LIMIT,
  QuotaError,
  RESERVATION_TTL_MS,
  commitSlot,
  getQuotaStatus,
  localDateKey,
  nextLocalMidnight,
  releaseSlot,
  reserveSlot,
} from '../quotaLimiter.js';
import { putUnsplash, touchWallpaper } from '../repository.js';
import { subscribe } from '../sync.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(i) { return Array.from(this.map.keys())[i] ?? null; }
  getItem(k) { return this.map.has(String(k)) ? this.map.get(String(k)) : null; }
  setItem(k, v) { this.map.set(String(k), String(v)); }
  removeItem(k) { this.map.delete(String(k)); }
  clear() { this.map.clear(); }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
  writable: true,
});

// 10:00 local time on a fixed day.
const T0 = new Date(2026, 9, 13, 10, 0, 0).getTime();

async function acquire(requestId, photoId, now = T0) {
  await reserveSlot({ requestId, now });
  return commitSlot(requestId, photoId, { now });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetIwebDBConnection();
  localStorage.clear();
});

afterEach(() => {
  _resetIwebDBConnection();
});

describe('date helpers', () => {
  it('uses the local calendar date', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDateKey(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });

  it('returns the next local midnight', () => {
    const next = nextLocalMidnight(new Date(2026, 11, 31, 18, 30));
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(0);
    expect(next.getDate()).toBe(1);
    expect(next.getHours()).toBe(0);
    expect(next.getMinutes()).toBe(0);
  });
});

describe('quota limiter', () => {
  it('starts with the full allowance', async () => {
    const status = await getQuotaStatus({ now: T0 });
    expect(status).toMatchObject({ date: '2026-10-13', used: 0, reserved: 0, remaining: 3, limit: DAILY_LIMIT });
    expect(status.resetsAt.getTime()).toBe(new Date(2026, 9, 14).getTime());
  });

  it('allows 3 acquisitions and blocks the 4th', async () => {
    for (let i = 1; i <= 3; i += 1) {
      expect(await acquire(`r${i}`, `p${i}`)).toEqual({ counted: true });
    }
    const err = await reserveSlot({ requestId: 'r4', now: T0 }).catch((e) => e);
    expect(err).toBeInstanceOf(QuotaError);
    expect(err.code).toBe('DAILY_LIMIT');
    expect(await getQuotaStatus({ now: T0 })).toMatchObject({ used: 3, reserved: 0, remaining: 0 });
  });

  it('release frees the slot and is idempotent', async () => {
    await acquire('r1', 'p1');
    await acquire('r2', 'p2');
    await reserveSlot({ requestId: 'r3', now: T0 });
    await expect(reserveSlot({ requestId: 'r4', now: T0 })).rejects.toBeInstanceOf(QuotaError);

    await releaseSlot('r3', { now: T0 });
    await releaseSlot('r3', { now: T0 });
    await releaseSlot('never-existed', { now: T0 });
    expect(await getQuotaStatus({ now: T0 })).toMatchObject({ used: 2, reserved: 0, remaining: 1 });
    await expect(reserveSlot({ requestId: 'r4', now: T0 })).resolves.toEqual({ requestId: 'r4' });
  });

  it('does not consume a slot for failed or cancelled fetches', async () => {
    async function fakeAcquire(fetcher) {
      const { requestId } = await reserveSlot({ now: T0 });
      try {
        const photoId = await fetcher();
        return await commitSlot(requestId, photoId, { now: T0 });
      } catch (err) {
        await releaseSlot(requestId, { now: T0 });
        throw err;
      }
    }
    await expect(fakeAcquire(async () => { throw new Error('network'); })).rejects.toThrow('network');
    await expect(fakeAcquire(async () => {
      throw new DOMException('aborted', 'AbortError');
    })).rejects.toThrow('aborted');
    expect(await getQuotaStatus({ now: T0 })).toMatchObject({ used: 0, reserved: 0, remaining: 3 });
  });

  it('generates a requestId when none is given', async () => {
    const { requestId } = await reserveSlot({ now: T0 });
    expect(typeof requestId).toBe('string');
    expect(requestId.length).toBeGreaterThan(0);
  });

  it('lets exactly one of 5 concurrent reservations take the last slot', async () => {
    await acquire('r1', 'p1');
    await acquire('r2', 'p2');
    const results = await Promise.allSettled(
      [1, 2, 3, 4, 5].map((i) => reserveSlot({ requestId: `c${i}`, now: T0 })),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const blocked = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(blocked).toHaveLength(4);
    blocked.forEach((r) => expect(r.reason.code).toBe('DAILY_LIMIT'));
    expect(await getQuotaStatus({ now: T0 })).toMatchObject({ used: 2, reserved: 1, remaining: 0 });
  });

  it('lets exactly 3 of many concurrent reservations through on a fresh day', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => reserveSlot({ requestId: `c${i}`, now: T0 })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
  });

  it('re-reserving the same requestId is idempotent', async () => {
    await reserveSlot({ requestId: 'same', now: T0 });
    await reserveSlot({ requestId: 'same', now: T0 + 1000 });
    expect(await getQuotaStatus({ now: T0 + 1000 })).toMatchObject({ reserved: 1, remaining: 2 });
  });

  it('commit is idempotent and never double-counts the same photo', async () => {
    await reserveSlot({ requestId: 'r1', now: T0 });
    expect(await commitSlot('r1', 'photo-a', { now: T0 })).toEqual({ counted: true });
    expect(await commitSlot('r1', 'photo-a', { now: T0 })).toEqual({ counted: true });
    expect(await getQuotaStatus({ now: T0 })).toMatchObject({ used: 1, reserved: 0 });

    // A different request for the same photo releases its reservation instead.
    await reserveSlot({ requestId: 'r2', now: T0 });
    expect(await commitSlot('r2', 'photo-a', { now: T0 })).toEqual({ counted: false });
    expect(await getQuotaStatus({ now: T0 })).toMatchObject({ used: 1, reserved: 0, remaining: 2 });
  });

  it('recovers expired reservations', async () => {
    await reserveSlot({ requestId: 'r1', now: T0 });
    await reserveSlot({ requestId: 'r2', now: T0 });
    await reserveSlot({ requestId: 'r3', now: T0 });
    await expect(reserveSlot({ requestId: 'r4', now: T0 + 1000 })).rejects.toBeInstanceOf(QuotaError);

    const later = T0 + RESERVATION_TTL_MS + 1;
    expect(await getQuotaStatus({ now: later })).toMatchObject({ used: 0, reserved: 0, remaining: 3 });
    await expect(reserveSlot({ requestId: 'r4', now: later })).resolves.toEqual({ requestId: 'r4' });
  });

  it('counts a late commit only while there is room', async () => {
    await reserveSlot({ requestId: 'slow', now: T0 });
    const later = T0 + RESERVATION_TTL_MS + 1;
    await acquire('a', 'pa', later);
    await acquire('b', 'pb', later);
    await acquire('c', 'pc', later);
    // The expired reservation's slot was reused; committing it must not exceed the limit.
    expect(await commitSlot('slow', 'p-slow', { now: later })).toEqual({ counted: false });
    expect(await getQuotaStatus({ now: later })).toMatchObject({ used: 3, remaining: 0 });
  });

  it('resets on a new local day', async () => {
    const lateEvening = new Date(2026, 9, 13, 23, 50).getTime();
    await acquire('r1', 'p1', lateEvening);
    await acquire('r2', 'p2', lateEvening);
    await acquire('r3', 'p3', lateEvening);
    await expect(reserveSlot({ requestId: 'r4', now: lateEvening })).rejects.toBeInstanceOf(QuotaError);

    const nextDay = new Date(2026, 9, 14, 0, 1).getTime();
    const status = await getQuotaStatus({ now: nextDay });
    expect(status).toMatchObject({ date: '2026-10-14', used: 0, reserved: 0, remaining: 3 });
    expect(status.resetsAt.getTime()).toBe(new Date(2026, 9, 15).getTime());
    expect(await acquire('r4', 'p1', nextDay)).toEqual({ counted: true });
  });

  it('persists state across a restart', async () => {
    await acquire('r1', 'p1');
    await reserveSlot({ requestId: 'r2', now: T0 });

    _resetIwebDBConnection();
    expect(await getQuotaStatus({ now: T0 + 10 })).toMatchObject({ used: 1, reserved: 1, remaining: 1 });
    expect(await commitSlot('r2', 'p2', { now: T0 + 20 })).toEqual({ counted: true });

    _resetIwebDBConnection();
    expect(await getQuotaStatus({ now: T0 + 30 })).toMatchObject({ used: 2, reserved: 0, remaining: 1 });
  });

  it('cached switching does not consume quota', async () => {
    await putUnsplash({ photoId: 'cached-1', blob: new Blob(['x']), acquiredAt: T0 - 1000 });
    await touchWallpaper({ source: 'unsplash', id: 'cached-1' }, { now: T0 });
    await touchWallpaper({ source: 'unsplash', id: 'cached-1' }, { now: T0 + 1 });
    await touchWallpaper({ source: 'local', id: 1 });
    expect(await getQuotaStatus({ now: T0 + 2 })).toMatchObject({ used: 0, reserved: 0, remaining: 3 });
  });

  it('broadcasts quota-changed after writes only', async () => {
    const events = [];
    const off = subscribe((msg) => events.push(msg.type));
    try {
      await getQuotaStatus({ now: T0 });
      await reserveSlot({ requestId: 'r1', now: T0 });
      await commitSlot('r1', 'p1', { now: T0 });
      await releaseSlot('r1', { now: T0 });
    } finally {
      off();
    }
    expect(events).toEqual(['quota-changed', 'quota-changed']);
  });

  it('rejects commits without ids', async () => {
    await expect(commitSlot('', 'p')).rejects.toBeInstanceOf(TypeError);
    await expect(commitSlot('r', '')).rejects.toBeInstanceOf(TypeError);
  });
});
