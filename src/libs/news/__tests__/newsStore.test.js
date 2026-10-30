import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetIwebDBConnection } from '../../wallpaper/db.js';
import { _resetNewsApi } from '../newsApi';
import { pruneNews, readFeed, saveFeed } from '../newsCache';
import { feedKey } from '../newsConfig';
import { _resetNewsStore, feedArticles, getState, loadFeed, refresh, search } from '../newsStore';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

const article = (id, overrides = {}) => ({
  id,
  title: `Story ${id}`,
  url: `https://news.google.com/rss/articles/${id}`,
  sourceName: 'The Hindu',
  sourceUrl: 'https://www.thehindu.com/',
  publishedAt: new Date().toISOString(),
  related: [],
  ...overrides,
});

const ok = (articles) => new Response(JSON.stringify({ articles, fetchedAt: Date.now() }), { status: 200 });
const TOP = feedKey({ edition: 'IN:en', category: 'top' });

let fetchMock;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetIwebDBConnection();
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubEnv('VITE_API_ORIGIN', 'https://iweb.test');
  fetchMock = vi.fn(async () => ok([article('a'), article('b')]));
  vi.stubGlobal('fetch', fetchMock);
  _resetNewsStore();
  _resetNewsApi();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  _resetIwebDBConnection();
});

describe('news store', () => {
  it('fetches a missing feed once, stores it, and shares it', async () => {
    await loadFeed({ category: 'top' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('op')).toBe('feed');
    expect(feedArticles(getState(), TOP).map((a) => a.id)).toEqual(['a', 'b']);
    expect((await readFeed(TOP)).articles.map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('shows a fresh cached feed without any request', async () => {
    await saveFeed({ key: TOP, kind: 'section', edition: 'IN:en', fetchedAt: Date.now() }, [article('c')]);
    const feed = await loadFeed({ category: 'top' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(feed).toMatchObject({ status: 'ready', fromCache: true });
    expect(feedArticles(getState(), TOP).map((a) => a.id)).toEqual(['c']);
  });

  it('refreshes a stale cached feed', async () => {
    await saveFeed({ key: TOP, kind: 'section', edition: 'IN:en', fetchedAt: Date.now() - 60 * 60 * 1000 }, [article('old')]);
    await loadFeed({ category: 'top' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(feedArticles(getState(), TOP).map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('keeps cached articles when a refresh fails, then backs off', async () => {
    await saveFeed({ key: TOP, kind: 'section', edition: 'IN:en', fetchedAt: Date.now() - 60 * 60 * 1000 }, [article('kept')]);
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: { code: 'UPSTREAM' } }), { status: 502 }));
    const feed = await loadFeed({ category: 'top' });
    expect(feed.status).toBe('error');
    expect(feedArticles(getState(), TOP).map((a) => a.id)).toEqual(['kept']);
    expect((await readFeed(TOP)).articles.map((a) => a.id)).toEqual(['kept']);
    // Backing off: no new request yet…
    await loadFeed({ category: 'top' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // …unless the user asks explicitly.
    fetchMock.mockImplementation(async () => ok([article('fresh')]));
    await refresh({ category: 'top' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(feedArticles(getState(), TOP).map((a) => a.id)).toEqual(['fresh']);
  });

  it('shares one request between simultaneous loads of the same feed', async () => {
    await Promise.all([loadFeed({ category: 'top' }), loadFeed({ category: 'top' }), loadFeed({ category: 'top' })]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not try the network offline, and says so', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const feed = await loadFeed({ category: 'technology' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(feed.error.code).toBe('OFFLINE');
  });

  it('searches as its own feed, merging into the shared articles', async () => {
    fetchMock.mockImplementation(async () => ok([article('s1', { title: 'Chandrayaan update' })]));
    await search('chandrayaan');
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ op: 'search', q: 'chandrayaan', edition: 'IN:en' });
    const key = feedKey({ edition: 'IN:en', query: 'chandrayaan' });
    expect(feedArticles(getState(), key).map((a) => a.title)).toEqual(['Chandrayaan update']);
    expect(getState().articles.s1).toBeTruthy();
  });

  it('prunes old unreferenced articles and old searches', async () => {
    const old = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    await saveFeed({ key: 'IN:en|search|old', kind: 'search', edition: 'IN:en', query: 'old', fetchedAt: 1 }, [article('gone', { publishedAt: old })]);
    await saveFeed({ key: TOP, kind: 'section', edition: 'IN:en', fetchedAt: Date.now() }, [article('keep', { publishedAt: old })]);
    const result = await pruneNews({ maxSearchFeeds: 0 });
    expect(result).toEqual({ removedArticles: 1, removedFeeds: 1 });
    expect((await readFeed(TOP)).articles.map((a) => a.id)).toEqual(['keep']);
  });
});
