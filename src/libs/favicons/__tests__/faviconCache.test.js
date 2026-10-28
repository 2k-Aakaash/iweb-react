import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetIwebDBConnection } from '../../wallpaper/db.js';

vi.mock('../../apiBase', () => ({ apiUrl: (path) => new URL(path, 'https://iweb.test') }));

const { getFavicon, REFRESH_MS, _resetFaviconCache, peekFavicon } = await import('../faviconCache.js');

const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
const DAY = 24 * 60 * 60 * 1000;

let fetchMock;
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetIwebDBConnection();
  _resetFaviconCache();
  fetchMock = vi.fn(async () => new Response(png(), { status: 200, headers: { 'content-type': 'image/png' } }));
  vi.stubGlobal('fetch', fetchMock);
  let n = 0;
  vi.stubGlobal('URL', Object.assign(class extends URL {}, {
    createObjectURL: () => `blob:icon-${++n}`,
    revokeObjectURL: () => {},
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetIwebDBConnection();
});

describe('favicon cache', () => {
  it('downloads once, then serves the stored icon without calling the API', async () => {
    const t0 = 1_000_000;
    const first = await getFavicon('example.com', { now: t0 });
    expect(first).toMatch(/^blob:/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://iweb.test/api/favicon?domain=example.com');

    const again = await getFavicon('example.com', { now: t0 + 6 * DAY });
    expect(again).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes in the background once a week has passed', async () => {
    const t0 = 1_000_000;
    await getFavicon('example.com', { now: t0 });
    const onUpdate = vi.fn();
    const stale = await getFavicon('example.com', { now: t0 + REFRESH_MS + 1, onUpdate });
    expect(stale).toMatch(/^blob:/); // the old icon is shown immediately
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.stringMatching(/^blob:/)));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the old icon when a refresh fails and waits a day before retrying', async () => {
    const t0 = 1_000_000;
    const first = await getFavicon('example.com', { now: t0 });
    fetchMock.mockRejectedValue(new TypeError('offline'));
    const t1 = t0 + REFRESH_MS + 1;
    await getFavicon('example.com', { now: t1 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));

    expect(await getFavicon('example.com', { now: t1 + DAY / 2 })).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(2); // no retry within the day

    await getFavicon('example.com', { now: t1 + DAY + 1 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it('makes stored icons available synchronously for the first render', async () => {
    const url = await getFavicon('example.com', { now: 1_000_000 });
    expect(peekFavicon('example.com')).toBe(url);
    expect(peekFavicon('unknown.com')).toBeUndefined();
  });

  it('remembers sites without an icon for a week', async () => {
    fetchMock.mockResolvedValue(new Response('No favicon found.', { status: 404 }));
    expect(await getFavicon('no-icon.test', { now: 1_000_000 })).toBeNull();
    expect(await getFavicon('no-icon.test', { now: 1_000_000 + DAY })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
