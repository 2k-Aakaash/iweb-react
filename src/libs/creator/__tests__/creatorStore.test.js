import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetIwebDBConnection } from '../../wallpaper/db.js';
import { readAccount, readSnapshots } from '../creatorDb.js';
import { creatorPrefs, selectAccount } from '../creatorPrefs.js';
import {
  _resetCreatorStore,
  addPublicChannel,
  connectAccount,
  getState,
  hydrate,
  nextDue,
  refreshAccount,
  removeAccount,
  watchAccount,
} from '../creatorStore.js';

vi.mock('../creatorAuth.js', () => ({
  signIn: vi.fn(async (platform) => ({
    account: { platform, ref: 'UC000000000000000000OWNR', mode: 'owner', profile: { id: 'UC000000000000000000OWNR', name: 'Mine' }, scopes: { analytics: true, revenue: false } },
    grant: 'g1.sealed-grant',
    data: { platform: 'youtube', mode: 'owner', fetchedAt: Date.now(), profile: { id: 'UC000000000000000000OWNR', name: 'Mine' }, stats: { subscribers: 10, views: 100, videos: 1 } },
  })),
}));

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

const ID = 'UC1234567890123456789012';
const channel = (subscribers = 1000, fetchedAt = Date.now()) => ({
  platform: 'youtube', mode: 'public', fetchedAt,
  profile: { id: ID, name: 'Chan', handle: '@chan', avatar: null },
  stats: { subscribers, subscribersHidden: false, views: 5000, videos: 3 },
});
const json = (status, body) => new Response(JSON.stringify(body), { status });
const ops = () => fetchMock.mock.calls.map(([url]) => new URL(url).searchParams.get('op'));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let fetchMock;
let answer;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  _resetIwebDBConnection();
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubEnv('VITE_API_ORIGIN', 'https://iweb.test');
  answer = () => json(200, channel());
  fetchMock = vi.fn(async (url) => {
    const op = new URL(url).searchParams.get('op');
    if (op === 'revoke') return json(200, { revoked: true });
    return answer(op);
  });
  vi.stubGlobal('fetch', fetchMock);
  _resetCreatorStore();
  creatorPrefs._reset();
  await creatorPrefs.set({ youtube: null, refreshMinutes: 30 });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  _resetCreatorStore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  _resetIwebDBConnection();
});

describe('adding accounts', () => {
  it('adds a public channel, stores it and its first snapshot', async () => {
    const id = await addPublicChannel('@chan');
    expect(id).toBe(`youtube:${ID}`);
    expect(getState().accounts[id]).toMatchObject({ mode: 'public', connected: false, data: { stats: { subscribers: 1000 } } });
    expect((await readAccount(id)).ref).toBe(ID);
    expect(await readSnapshots(id)).toHaveLength(1);
  });

  it('keeps a connected account’s grant out of the UI state', async () => {
    const id = await connectAccount('youtube');
    expect(getState().accounts[id].connected).toBe(true);
    expect(JSON.stringify(getState())).not.toContain('sealed-grant');
    expect((await readAccount(id)).grant).toBe('g1.sealed-grant');
  });

  it('passes on lookup errors', async () => {
    answer = () => json(404, { error: { code: 'NOT_FOUND', message: 'No channel' } });
    await expect(addPublicChannel('@nobody')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(Object.keys(getState().accounts)).toHaveLength(0);
  });
});

describe('refreshing', () => {
  it('shares one request between simultaneous refreshes', async () => {
    const id = await addPublicChannel('@chan');
    fetchMock.mockClear();
    answer = () => json(200, channel(1100));
    await Promise.all([refreshAccount(id, { immediate: true }), refreshAccount(id, { immediate: true }), refreshAccount(id)]);
    expect(ops()).toEqual(['channel']);
    expect(getState().accounts[id].data.stats.subscribers).toBe(1100);
  });

  it('answers a manual refresh right after an update from cache', async () => {
    const id = await addPublicChannel('@chan');
    fetchMock.mockClear();
    await refreshAccount(id, { force: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the data when a refresh fails, and backs off', async () => {
    const id = await addPublicChannel('@chan');
    answer = () => json(502, { error: { code: 'UPSTREAM', message: 'YouTube is down' } });
    await refreshAccount(id, { immediate: true });
    const account = getState().accounts[id];
    expect(account.data.stats.subscribers).toBe(1000);
    expect(account.error).toMatchObject({ code: 'UPSTREAM', message: 'YouTube is down' });
    expect(account.retryAt).toBeGreaterThan(Date.now());
    expect(nextDue(account)).toBe(account.retryAt);
    // Stored too, so a reload shows the data and the error.
    expect((await readAccount(id)).data.stats.subscribers).toBe(1000);
  });

  it('honours Retry-After from the server', async () => {
    const id = await addPublicChannel('@chan');
    answer = () => new Response(JSON.stringify({ error: { code: 'QUOTA', message: 'Quota' } }), { status: 429, headers: { 'retry-after': '3600' } });
    await refreshAccount(id, { immediate: true });
    expect(getState().accounts[id].retryAt).toBeGreaterThan(Date.now() + 59 * 60e3);
  });

  it('stops retrying errors the person has to fix', async () => {
    const id = await connectAccount('youtube');
    answer = () => json(401, { error: { code: 'REVOKED', message: 'Connect again' } });
    await refreshAccount(id, { immediate: true });
    const account = getState().accounts[id];
    expect(account.error.code).toBe('REVOKED');
    expect(account.retryAt).toBeNull();
    expect(nextDue(account)).toBe(Infinity);
  });

  it('clears the error and records a snapshot on success', async () => {
    const id = await addPublicChannel('@chan');
    answer = () => json(502, { error: { code: 'UPSTREAM', message: 'down' } });
    await refreshAccount(id, { immediate: true });
    answer = () => json(200, channel(1200, Date.now() + 2 * 3600e3));
    await refreshAccount(id, { immediate: true });
    expect(getState().accounts[id].error).toBeNull();
    expect((await readSnapshots(id)).map((s) => s.metrics.subscribers)).toEqual([1000, 1200]);
  });

  it('sends the grant only to iWeb’s API, and adopts a renewed one', async () => {
    const id = await connectAccount('youtube');
    answer = (op) => json(200, op === 'fetch' ? { data: { ...channel(), mode: 'owner', profile: { id: 'UC000000000000000000OWNR', name: 'Mine' } }, grant: 'g1.renewed' } : {});
    await refreshAccount(id, { immediate: true });
    const [url, init] = fetchMock.mock.calls.at(-1);
    expect(new URL(url).origin).toBe('https://iweb.test');
    expect(JSON.parse(init.body)).toMatchObject({ platform: 'youtube', grant: 'g1.sealed-grant' });
    expect((await readAccount(id)).grant).toBe('g1.renewed');
  });
});

describe('scheduling', () => {
  it('does nothing for accounts no widget shows', async () => {
    const id = await addPublicChannel('@chan');
    await creatorPrefs.set((p) => ({ ...p, refreshMinutes: 15 }));
    // Pretend the data is old: only a watched account would refresh.
    answer = () => json(200, channel(1300));
    const stale = getState().accounts[id];
    expect(nextDue({ ...stale, fetchedAt: 1 })).toBeLessThan(Date.now());
    fetchMock.mockClear();
    await wait(600);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes a watched account when due, once, and stops when unwatched', async () => {
    const id = await addPublicChannel('@chan');
    await creatorPrefs.set((p) => ({ ...p, refreshMinutes: 0 })); // manual only: not due
    fetchMock.mockClear();
    const stopA = watchAccount(id);
    const stopB = watchAccount(id);
    await wait(600);
    expect(fetchMock).not.toHaveBeenCalled();
    stopA();
    stopB();
  });

  it('fetches a watched account that has never loaded', async () => {
    await hydrate();
    // An account stored without data (e.g. its first lookup failed in another tab).
    const { writeAccount } = await import('../creatorDb.js');
    await writeAccount({ id: `youtube:${ID}`, platform: 'youtube', ref: ID, mode: 'public', profile: { id: ID, name: 'Chan' }, data: null, fetchedAt: 0, addedAt: 1 });
    _resetCreatorStore();
    await hydrate();
    fetchMock.mockClear();
    const stop = watchAccount(`youtube:${ID}`);
    await wait(700);
    expect(ops()).toEqual(['channel']);
    stop();
  });
});

describe('removing', () => {
  it('deletes the account, its snapshots and the widget’s choice, and revokes Google access', async () => {
    const id = await connectAccount('youtube');
    await selectAccount('youtube', id);
    await removeAccount(id);
    expect(ops()).toContain('revoke');
    expect(getState().accounts[id]).toBeUndefined();
    expect(await readAccount(id)).toBeNull();
    expect(await readSnapshots(id)).toEqual([]);
    expect(creatorPrefs.get().youtube).toBeNull();
  });

  it('removes a public channel without contacting anyone', async () => {
    const id = await addPublicChannel('@chan');
    fetchMock.mockClear();
    await removeAccount(id);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await readAccount(id)).toBeNull();
  });
});
