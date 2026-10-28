import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
  store: new Map(),
  remaining: 3,
  reservations: new Set(),
  active: null,
}));

vi.mock('../quotaLimiter.js', () => {
  class QuotaError extends Error {
    constructor(message, { code = 'DAILY_LIMIT', resetsAt = null } = {}) {
      super(message);
      this.name = 'QuotaError';
      this.code = code;
      this.resetsAt = resetsAt;
    }
  }
  return {
    QuotaError,
    getQuotaStatus: vi.fn(async () => ({
      date: '2026-10-13',
      used: 3 - state.remaining - state.reservations.size,
      reserved: state.reservations.size,
      remaining: state.remaining,
      limit: 3,
      resetsAt: new Date(2026, 9, 14),
    })),
    reserveSlot: vi.fn(async ({ requestId }) => {
      if (state.remaining <= 0) throw new QuotaError('limit');
      state.remaining -= 1;
      state.reservations.add(requestId);
      return { requestId };
    }),
    commitSlot: vi.fn(async (requestId) => {
      state.reservations.delete(requestId);
      return { counted: true };
    }),
    pauseAcquisitions: vi.fn(),
    releaseSlot: vi.fn(async (requestId) => {
      if (state.reservations.delete(requestId)) state.remaining += 1;
    }),
  };
});

vi.mock('../repository.js', () => ({
  getUnsplash: vi.fn(async (id) => state.store.get(id) ?? null),
  putUnsplash: vi.fn(async (record) => {
    state.store.set(record.photoId, record);
    return record;
  }),
  listUnsplash: vi.fn(async () => [...state.store.values()].sort((a, b) => b.acquiredAt - a.acquiredAt)),
  searchUnsplashCache: vi.fn(async (query) => {
    const tokens = query.toLowerCase().split(/\s+/);
    return [...state.store.values()].filter((r) => tokens.every((t) => r.keywords.includes(t)));
  }),
  touchWallpaper: vi.fn(async (ref) => {
    const record = state.store.get(ref.id);
    if (!record) return null;
    const updated = { ...record, lastUsedAt: Date.now() };
    state.store.set(ref.id, updated);
    return updated;
  }),
  evictUnsplashCache: vi.fn(async () => 0),
  deleteWallpapers: vi.fn(async (refs) => {
    for (const ref of refs) state.store.delete(ref.id);
    return { deleted: refs, missing: [], newActive: null };
  }),
  isQuotaExceededError: vi.fn((err) => err?.name === 'QuotaExceededError'),
}));

vi.mock('../settings.js', () => ({
  getWallpaperSettings: vi.fn(() => ({ source: 'unsplash', discoveryMode: 'topics', topics: [], keyword: '' })),
  getActiveWallpaper: vi.fn(() => state.active),
  setActiveWallpaper: vi.fn((ref) => {
    state.active = ref;
    return ref;
  }),
}));

vi.mock('../imageLoader.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchImageBlob: vi.fn(async () => new Blob([new Uint8Array(1000)], { type: 'image/jpeg' })),
    makeThumbnail: vi.fn(async () => new Blob([new Uint8Array(10)], { type: 'image/webp' })),
    decodeImage: vi.fn(async () => ({})),
  };
});

vi.mock('../unsplashClient.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isUnsplashConfigured: vi.fn(() => true),
    getRandomPhotos: vi.fn(async () => []),
    searchPhotos: vi.fn(async () => ({ results: [], total: 0, totalPages: 0 })),
    trackDownload: vi.fn(async () => undefined),
    getApiRateInfo: vi.fn(() => null),
  };
});

const quota = await import('../quotaLimiter.js');
const repo = await import('../repository.js');
const settingsModule = await import('../settings.js');
const loader = await import('../imageLoader.js');
const client = await import('../unsplashClient.js');
const { acquirePhoto, changeUnsplashBackground, prefetchNextUnsplash, searchWallpapers, CURATED_TOPICS } = await import('../discovery.js');

function photo(id, overrides = {}) {
  return {
    photoId: id,
    width: 4000,
    height: 2500,
    color: '#112233',
    description: 'Snowy mountain peak',
    urls: {
      raw: `https://images.unsplash.com/photo-${id}?ixid=abc`,
      full: `https://images.unsplash.com/photo-${id}?ixid=abc&fm=jpg`,
      regular: `https://images.unsplash.com/photo-${id}?ixid=abc&w=1080`,
      small: `https://images.unsplash.com/photo-${id}?ixid=abc&w=400`,
      thumb: `https://images.unsplash.com/photo-${id}?ixid=abc&w=200`,
    },
    photographer: { name: 'Jane', username: 'jane', profileUrl: 'https://unsplash.com/@jane?utm_source=iweb&utm_medium=referral' },
    photoPageUrl: `https://unsplash.com/photos/${id}?utm_source=iweb&utm_medium=referral`,
    downloadLocation: `https://api.unsplash.com/photos/${id}/download?ixid=abc`,
    tags: ['Alps'],
    ...overrides,
  };
}

function cachedRecord(id, { topic = 'mountains', keywords = ['mountains', 'snow'], acquiredAt = 1000, lastUsedAt = null } = {}) {
  return {
    ...photo(id),
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    thumb: null,
    size: 1,
    query: 'mountains',
    topic,
    keywords,
    acquiredAt,
    lastUsedAt,
  };
}

function seed(...records) {
  for (const record of records) state.store.set(record.photoId, record);
}

const topicSettings = { source: 'unsplash', discoveryMode: 'topics', topics: ['mountains'], keyword: '' };

beforeEach(() => {
  state.store.clear();
  state.remaining = 3;
  state.reservations.clear();
  state.active = null;
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CURATED_TOPICS', () => {
  it('exposes the curated search queries', () => {
    expect(CURATED_TOPICS).toHaveLength(12);
    expect(CURATED_TOPICS.map((t) => t.label)).toContain('Dark & Moody');
    for (const topic of CURATED_TOPICS) {
      expect(topic).toEqual({ id: expect.any(String), label: expect.any(String), query: expect.any(String) });
    }
  });
});

describe('acquirePhoto', () => {
  it('reserves, downloads, stores, commits, tracks and evicts on success', async () => {
    const record = await acquirePhoto(photo('p1'), { query: 'mountains', topic: 'mountains' });

    expect(quota.reserveSlot).toHaveBeenCalledTimes(1);
    const { requestId } = quota.reserveSlot.mock.calls[0][0];
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);

    const url = new URL(loader.fetchImageBlob.mock.calls[0][0]);
    expect(url.hostname).toBe('images.unsplash.com');
    expect(url.searchParams.get('ixid')).toBe('abc');
    expect(Number(url.searchParams.get('w'))).toBeLessThanOrEqual(4000);

    expect(repo.putUnsplash).toHaveBeenCalledTimes(1);
    expect(quota.commitSlot).toHaveBeenCalledWith(requestId, 'p1');
    expect(quota.releaseSlot).not.toHaveBeenCalled();
    expect(client.trackDownload).toHaveBeenCalledWith('https://api.unsplash.com/photos/p1/download?ixid=abc');
    expect(repo.evictUnsplashCache).toHaveBeenCalledWith({ protect: ['p1'] });

    expect(record).toMatchObject({
      photoId: 'p1',
      size: 1000,
      query: 'mountains',
      topic: 'mountains',
      lastUsedAt: null,
      photographer: { name: 'Jane' },
    });
    expect(record.blob).toBeInstanceOf(Blob);
    expect(record.thumb).toBeInstanceOf(Blob);
    expect(record.keywords).toEqual(expect.arrayContaining(['mountains', 'snowy', 'mountain', 'peak', 'alps']));
    expect(state.reservations.size).toBe(0);
    expect(state.remaining).toBe(2);
  });

  it('commits before tracking the download', async () => {
    await acquirePhoto(photo('p1'));
    const commitOrder = quota.commitSlot.mock.invocationCallOrder[0];
    const trackOrder = client.trackDownload.mock.invocationCallOrder[0];
    expect(commitOrder).toBeLessThan(trackOrder);
  });

  it('releases the reservation when the download fails', async () => {
    loader.fetchImageBlob.mockRejectedValueOnce(new Error('HTTP 500'));
    await expect(acquirePhoto(photo('p1'))).rejects.toThrow('HTTP 500');
    const { requestId } = quota.reserveSlot.mock.calls[0][0];
    expect(quota.releaseSlot).toHaveBeenCalledWith(requestId);
    expect(quota.commitSlot).not.toHaveBeenCalled();
    expect(repo.putUnsplash).not.toHaveBeenCalled();
    expect(client.trackDownload).not.toHaveBeenCalled();
    expect(state.remaining).toBe(3);
  });

  it('does not reserve for an already cached photo', async () => {
    const existing = cachedRecord('p1');
    seed(existing);
    const record = await acquirePhoto(photo('p1'));
    expect(record).toBe(existing);
    expect(quota.reserveSlot).not.toHaveBeenCalled();
    expect(loader.fetchImageBlob).not.toHaveBeenCalled();
  });

  it('propagates QuotaError without downloading when no slot is left', async () => {
    state.remaining = 0;
    await expect(acquirePhoto(photo('p1'))).rejects.toMatchObject({ name: 'QuotaError', code: 'DAILY_LIMIT' });
    expect(loader.fetchImageBlob).not.toHaveBeenCalled();
  });

  it('releases and never commits when aborted during the download', async () => {
    const controller = new AbortController();
    loader.fetchImageBlob.mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    await expect(acquirePhoto(photo('p1'), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(quota.releaseSlot).toHaveBeenCalledTimes(1);
    expect(quota.commitSlot).not.toHaveBeenCalled();
  });

  it('rolls back a stored record when aborted before the commit', async () => {
    const controller = new AbortController();
    repo.putUnsplash.mockImplementationOnce(async (record) => {
      state.store.set(record.photoId, record);
      controller.abort();
      return record;
    });
    await expect(acquirePhoto(photo('p1'), { signal: controller.signal })).rejects.toMatchObject({ code: 'ABORTED' });
    expect(quota.commitSlot).not.toHaveBeenCalled();
    expect(quota.releaseSlot).toHaveBeenCalledTimes(1);
    expect(repo.deleteWallpapers).toHaveBeenCalledWith([{ source: 'unsplash', id: 'p1' }]);
    expect(state.store.has('p1')).toBe(false);
  });

  it('evicts and retries once on a storage quota error', async () => {
    const quotaErr = new DOMException('full', 'QuotaExceededError');
    repo.putUnsplash.mockRejectedValueOnce(quotaErr);
    const record = await acquirePhoto(photo('p1'));
    expect(record.photoId).toBe('p1');
    expect(repo.evictUnsplashCache).toHaveBeenNthCalledWith(1);
    expect(repo.putUnsplash).toHaveBeenCalledTimes(2);
    expect(quota.commitSlot).toHaveBeenCalledTimes(1);
  });

  it('releases when storage still fails after eviction', async () => {
    const quotaErr = new DOMException('full', 'QuotaExceededError');
    repo.putUnsplash.mockRejectedValueOnce(quotaErr).mockRejectedValueOnce(quotaErr);
    await expect(acquirePhoto(photo('p1'))).rejects.toBe(quotaErr);
    expect(quota.releaseSlot).toHaveBeenCalledTimes(1);
    expect(quota.commitSlot).not.toHaveBeenCalled();
  });

  it('does not fail when download tracking fails', async () => {
    client.trackDownload.mockRejectedValueOnce(new client.UnsplashError('NETWORK', 'down'));
    await expect(acquirePhoto(photo('p1'))).resolves.toMatchObject({ photoId: 'p1' });
    await Promise.resolve();
    expect(quota.commitSlot).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed photos without reserving', async () => {
    await expect(acquirePhoto({ photoId: 'x', urls: {} })).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    expect(quota.reserveSlot).not.toHaveBeenCalled();
  });
});

describe('searchWallpapers', () => {
  it('searches only the cache when the daily limit is reached', async () => {
    state.remaining = 0;
    seed(cachedRecord('c1', { keywords: ['mountains'] }), cachedRecord('c2', { keywords: ['ocean'] }));
    const res = await searchWallpapers({ query: 'Mountains' });
    expect(client.searchPhotos).not.toHaveBeenCalled();
    expect(res).toMatchObject({ fromCache: true, limitReached: true, totalPages: 1 });
    expect(res.results.map((r) => r.photoId)).toEqual(['c1']);
    expect(res.results[0].cached).toBe(true);
    expect(res.results[0]).not.toHaveProperty('blob');
  });

  it('searches only the cache when offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const res = await searchWallpapers({ query: 'ocean' });
    expect(client.searchPhotos).not.toHaveBeenCalled();
    expect(res).toMatchObject({ fromCache: true, limitReached: false, results: [] });
  });

  it('calls the API and marks cached results', async () => {
    seed(cachedRecord('p2'));
    client.searchPhotos.mockResolvedValueOnce({ results: [photo('p1'), photo('p2')], total: 2, totalPages: 1 });
    const res = await searchWallpapers({ query: '  snowy  peaks ', page: 2 });
    expect(client.searchPhotos).toHaveBeenCalledWith(expect.objectContaining({ query: 'snowy peaks', page: 2 }));
    expect(res.fromCache).toBe(false);
    expect(res.results.map((r) => [r.photoId, r.cached])).toEqual([['p1', false], ['p2', true]]);
  });

  it('falls back to the cache when the API is rate limited', async () => {
    seed(cachedRecord('c1', { keywords: ['forest'] }));
    client.searchPhotos.mockRejectedValueOnce(new client.UnsplashError('RATE_LIMITED', 'limit'));
    const res = await searchWallpapers({ query: 'forest' });
    expect(res.fromCache).toBe(true);
    expect(res.results.map((r) => r.photoId)).toEqual(['c1']);
  });

  it('rejects an empty query', async () => {
    await expect(searchWallpapers({ query: '   ' })).rejects.toMatchObject({ code: 'INVALID_QUERY' });
  });
});

describe('changeUnsplashBackground', () => {
  it('prefers an unseen cached image matching the selection', async () => {
    seed(
      cachedRecord('seen', { lastUsedAt: 5000 }),
      cachedRecord('other-topic', { topic: 'ocean', keywords: ['ocean'] }),
      cachedRecord('unseen', { acquiredAt: 2000 }),
    );
    const res = await changeUnsplashBackground({ settings: topicSettings });
    expect(res.origin).toBe('cache');
    expect(res.record.photoId).toBe('unseen');
    expect(typeof res.record.lastUsedAt).toBe('number');
    expect(res.quota).toMatchObject({ remaining: 3, limit: 3 });
    expect(client.getRandomPhotos).not.toHaveBeenCalled();
    expect(quota.reserveSlot).not.toHaveBeenCalled();
    expect(repo.touchWallpaper).toHaveBeenCalledWith({ source: 'unsplash', id: 'unseen' });
    expect(settingsModule.setActiveWallpaper).toHaveBeenCalledWith({ source: 'unsplash', id: 'unseen' });
  });

  it('prefetches the next photo without the download ping, and pings when it is shown', async () => {
    seed(cachedRecord('seen', { lastUsedAt: 5000 }));
    vi.spyOn(Math, 'random').mockReturnValue(0);
    client.getRandomPhotos.mockResolvedValueOnce([photo('next')]);

    const prefetched = await prefetchNextUnsplash({ settings: topicSettings });
    expect(prefetched.photoId).toBe('next');
    expect(prefetched.downloadPending).toBe(true);
    expect(client.trackDownload).not.toHaveBeenCalled();

    const res = await changeUnsplashBackground({ settings: topicSettings });
    expect(res.origin).toBe('cache');
    expect(res.record.photoId).toBe('next');
    expect(client.trackDownload).toHaveBeenCalledTimes(1);
  });

  it('pauses new downloads when Unsplash reports its shared limit nearly used', async () => {
    seed(cachedRecord('seen', { lastUsedAt: 5000 }));
    client.getApiRateInfo.mockReturnValue({ limit: 1000, remaining: 10, updatedAt: Date.now() });
    client.getRandomPhotos.mockResolvedValueOnce([photo('fresh')]);
    await changeUnsplashBackground({ settings: topicSettings });
    expect(quota.pauseAcquisitions).toHaveBeenCalledWith(expect.any(Number));
    client.getApiRateInfo.mockReturnValue(null);
  });

  it('pauses new downloads after a rate-limit response and falls back to the cache', async () => {
    seed(cachedRecord('seen', { lastUsedAt: 5000 }));
    client.getRandomPhotos.mockRejectedValueOnce(Object.assign(new client.UnsplashError('RATE_LIMITED', 'busy'), { retryAfter: 120 }));
    const res = await changeUnsplashBackground({ settings: topicSettings });
    expect(res.origin).toBe('cache');
    const until = quota.pauseAcquisitions.mock.calls.at(-1)[0];
    expect(until - Date.now()).toBeGreaterThan(110 * 1000);
    expect(until - Date.now()).toBeLessThanOrEqual(120 * 1000);
  });

  it('skips the prefetch when an unseen matching photo is already cached', async () => {
    seed(cachedRecord('unseen'));
    expect(await prefetchNextUnsplash({ settings: topicSettings })).toBeNull();
    expect(client.getRandomPhotos).not.toHaveBeenCalled();
  });

  it('fetches a new photo when no unseen cached image matches', async () => {
    seed(cachedRecord('seen', { lastUsedAt: 5000 }));
    vi.spyOn(Math, 'random').mockReturnValue(0);
    client.getRandomPhotos.mockResolvedValueOnce([photo('seen'), photo('fresh')]);

    const res = await changeUnsplashBackground({ settings: topicSettings });

    expect(client.getRandomPhotos).toHaveBeenCalledWith(expect.objectContaining({ query: 'mountains', count: 30 }));
    expect(res.origin).toBe('new');
    expect(res.record.photoId).toBe('fresh');
    expect(res.quota.remaining).toBe(2);
    expect(quota.commitSlot).toHaveBeenCalledWith(expect.any(String), 'fresh');
    expect(settingsModule.setActiveWallpaper).toHaveBeenCalledWith({ source: 'unsplash', id: 'fresh' });
    expect(repo.touchWallpaper).toHaveBeenCalledWith({ source: 'unsplash', id: 'fresh' });
  });

  it('sends no query when no topics are selected', async () => {
    client.getRandomPhotos.mockResolvedValueOnce([photo('fresh')]);
    await changeUnsplashBackground({ settings: { ...topicSettings, topics: [] } });
    expect(client.getRandomPhotos.mock.calls[0][0].query).toBeUndefined();
  });

  it('uses the search endpoint in keyword mode', async () => {
    client.searchPhotos.mockResolvedValueOnce({ results: [photo('kw')], total: 1, totalPages: 1 });
    const res = await changeUnsplashBackground({
      settings: { source: 'unsplash', discoveryMode: 'keyword', topics: [], keyword: ' red  cars ' },
    });
    expect(client.searchPhotos).toHaveBeenCalledWith(expect.objectContaining({ query: 'red cars', perPage: 30 }));
    expect(client.getRandomPhotos).not.toHaveBeenCalled();
    expect(res.record).toMatchObject({ photoId: 'kw', query: 'red cars' });
  });

  it('rotates to the least-recently-used cached image when the limit is reached', async () => {
    state.remaining = 0;
    seed(
      cachedRecord('recent', { lastUsedAt: 9000 }),
      cachedRecord('oldest', { lastUsedAt: 1000 }),
      cachedRecord('active', { lastUsedAt: 500 }),
    );
    state.active = { source: 'unsplash', id: 'active' };
    const res = await changeUnsplashBackground({ settings: topicSettings });
    expect(client.getRandomPhotos).not.toHaveBeenCalled();
    expect(res.origin).toBe('cache');
    expect(res.record.photoId).toBe('oldest');
  });

  it('rotates through the cache when the API fails', async () => {
    seed(cachedRecord('old', { lastUsedAt: 1000 }));
    client.getRandomPhotos.mockRejectedValueOnce(new client.UnsplashError('RATE_LIMITED', 'limit'));
    const res = await changeUnsplashBackground({ settings: topicSettings });
    expect(res).toMatchObject({ origin: 'cache', record: { photoId: 'old' } });
    expect(quota.reserveSlot).not.toHaveBeenCalled();
  });

  it('rotates through the cache when offline without calling the API', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    seed(cachedRecord('old', { lastUsedAt: 1000 }));
    const res = await changeUnsplashBackground({ settings: topicSettings });
    expect(res.record.photoId).toBe('old');
    expect(client.getRandomPhotos).not.toHaveBeenCalled();
  });

  it('throws QuotaError when nothing is cached and the limit is reached', async () => {
    state.remaining = 0;
    await expect(changeUnsplashBackground({ settings: topicSettings }))
      .rejects.toMatchObject({ name: 'QuotaError', code: 'DAILY_LIMIT' });
    expect(client.getRandomPhotos).not.toHaveBeenCalled();
    expect(settingsModule.setActiveWallpaper).not.toHaveBeenCalled();
  });

  it('rethrows the API error when nothing is cached', async () => {
    client.getRandomPhotos.mockRejectedValueOnce(new client.UnsplashError('UNAUTHORIZED', 'bad key'));
    await expect(changeUnsplashBackground({ settings: topicSettings })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('supersedes an older call so it never commits', async () => {
    let firstStarted = false;
    loader.fetchImageBlob.mockImplementationOnce((url, { signal }) => new Promise((resolve, reject) => {
      firstStarted = true;
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    client.getRandomPhotos
      .mockResolvedValueOnce([photo('first')])
      .mockResolvedValueOnce([photo('second')]);

    const first = changeUnsplashBackground({ settings: topicSettings });
    await vi.waitFor(() => expect(firstStarted).toBe(true));
    const second = changeUnsplashBackground({ settings: topicSettings });

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const res = await second;
    expect(res.record.photoId).toBe('second');
    expect(quota.commitSlot).toHaveBeenCalledTimes(1);
    expect(quota.commitSlot).toHaveBeenCalledWith(expect.any(String), 'second');
    expect(state.reservations.size).toBe(0);
    expect(state.remaining).toBe(2);
  });
});
