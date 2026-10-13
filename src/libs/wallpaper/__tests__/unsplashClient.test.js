import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getRandomPhotos,
  searchPhotos,
  trackDownload,
  isUnsplashConfigured,
  getApiRateInfo,
  normalizePhoto,
  normalizeQuery,
  withUtm,
  UnsplashError,
  _resetApiRateInfo,
} from '../unsplashClient.js';

const KEY = 'access-key-123';

function rawPhoto(id = 'abc123', overrides = {}) {
  return {
    id,
    width: 6000,
    height: 4000,
    color: '#A7A2A1',
    description: '  A   quiet\nlake  ',
    alt_description: 'lake',
    urls: {
      raw: `https://images.unsplash.com/photo-${id}?ixid=xyz`,
      full: `https://images.unsplash.com/photo-${id}?ixid=xyz&fm=jpg&q=80`,
      regular: `https://images.unsplash.com/photo-${id}?ixid=xyz&w=1080`,
      small: `https://images.unsplash.com/photo-${id}?ixid=xyz&w=400`,
      thumb: `https://images.unsplash.com/photo-${id}?ixid=xyz&w=200`,
    },
    links: {
      html: `https://unsplash.com/photos/${id}`,
      download_location: `https://api.unsplash.com/photos/${id}/download?ixid=xyz`,
    },
    user: { name: 'Jane Doe', username: 'jane', links: { html: 'https://unsplash.com/@jane' } },
    tags: [{ title: 'Mountain' }, { title: 'mountain' }, { title: 'Lake' }],
    ...overrides,
  };
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Ratelimit-Limit': '50',
      'X-Ratelimit-Remaining': '49',
      ...headers,
    },
  });
}

function textResponse(text, { status, headers = {} }) {
  return new Response(text, { status, headers });
}

const PROXY = 'https://proxy.test/api/unsplash';

let fetchMock;

beforeEach(() => {
  vi.stubEnv('VITE_UNSPLASH_PROXY_URL', PROXY);
  vi.stubEnv('VITE_UNSPLASH_APP_NAME', 'iweb');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  _resetApiRateInfo();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('configuration and auth', () => {
  it('is configured when a proxy URL is resolvable', () => {
    expect(isUnsplashConfigured()).toBe(true);
    // A relative proxy path has no http(s) origin in node (like chrome-extension://).
    vi.stubEnv('VITE_UNSPLASH_PROXY_URL', '');
    expect(isUnsplashConfigured()).toBe(false);
  });

  it('routes the random endpoint through the proxy without sending any key', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([rawPhoto()]));
    const photos = await getRandomPhotos({ query: '  misty   mountains ', count: 10 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(PROXY);
    expect(parsed.searchParams.get('path')).toBe('/photos/random');
    expect(parsed.searchParams.get('query')).toBe('misty mountains');
    expect(parsed.searchParams.get('count')).toBe('10');
    expect(parsed.searchParams.get('orientation')).toBe('landscape');
    expect(parsed.searchParams.get('content_filter')).toBe('high');
    expect(parsed.searchParams.has('client_id')).toBe(false);
    expect(init.headers?.Authorization).toBeUndefined();
    expect(url).not.toContain(KEY);
    expect(photos).toHaveLength(1);
    expect(photos[0].photoId).toBe('abc123');
  });

  it('caps count at 30 and omits the query when none is given', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await getRandomPhotos({ count: 99 });
    const parsed = new URL(fetchMock.mock.calls[0][0]);
    expect(parsed.searchParams.get('count')).toBe('30');
    expect(parsed.searchParams.has('query')).toBe(false);
  });

  it('throws NOT_CONFIGURED without calling fetch when no proxy is resolvable', async () => {
    vi.stubEnv('VITE_UNSPLASH_PROXY_URL', '');
    await expect(getRandomPhotos()).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps the proxy "not configured" 500 to NOT_CONFIGURED without retrying', async () => {
    fetchMock.mockResolvedValue(textResponse('{"errors":["Unsplash proxy is not configured (UNSPLASH_ACCESS_KEY missing)."]}', { status: 500 }));
    await expect(getRandomPhotos()).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 401 to UNAUTHORIZED without retrying and never leaks the key', async () => {
    fetchMock.mockResolvedValue(textResponse('OAuth error: The access token is invalid', { status: 401 }));
    const err = await getRandomPhotos().catch((e) => e);
    expect(err).toBeInstanceOf(UnsplashError);
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.status).toBe(401);
    expect(err.message).not.toContain(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps a plain 403 to UNAUTHORIZED', async () => {
    fetchMock.mockResolvedValue(textResponse('Forbidden', { status: 403 }));
    await expect(getRandomPhotos()).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('rate limiting', () => {
  it('maps 403 "Rate Limit Exceeded" to RATE_LIMITED without retrying', async () => {
    fetchMock.mockResolvedValue(textResponse('Rate Limit Exceeded', {
      status: 403,
      headers: { 'X-Ratelimit-Limit': '50', 'X-Ratelimit-Remaining': '0', 'Retry-After': '120' },
    }));
    const err = await getRandomPhotos().catch((e) => e);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.retryAfter).toBe(120);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getApiRateInfo()).toMatchObject({ limit: 50, remaining: 0 });
  });

  it('treats a 403 with Remaining=0 as RATE_LIMITED', async () => {
    fetchMock.mockResolvedValue(textResponse('', {
      status: 403,
      headers: { 'X-Ratelimit-Remaining': '0' },
    }));
    await expect(searchPhotos({ query: 'sea' })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('records rate info from successful responses', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([], { headers: { 'X-Ratelimit-Remaining': '42' } }));
    expect(getApiRateInfo()).toBeNull();
    await getRandomPhotos();
    const info = getApiRateInfo();
    expect(info).toMatchObject({ limit: 50, remaining: 42 });
    expect(typeof info.updatedAt).toBe('number');
  });
});

describe('retries', () => {
  it('retries a 500 and then succeeds', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(textResponse('oops', { status: 500 }))
      .mockResolvedValueOnce(textResponse('oops', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse([rawPhoto()]));
    const promise = getRandomPhotos();
    await vi.runAllTimersAsync();
    const photos = await promise;
    expect(photos).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up with SERVER after two retries', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => textResponse('down', { status: 500 }));
    const promise = getRandomPhotos().catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await promise;
    expect(err.code).toBe('SERVER');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries network failures', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse([rawPhoto()]));
    const promise = getRandomPhotos();
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honours Retry-After on a retryable error', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(textResponse('busy', { status: 503, headers: { 'Retry-After': '5' } }))
      .mockResolvedValueOnce(jsonResponse([]));
    const promise = getRandomPhotos();
    await vi.advanceTimersByTimeAsync(4900);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry 404', async () => {
    fetchMock.mockResolvedValue(textResponse('Not found', { status: 404 }));
    await expect(trackDownload('https://api.unsplash.com/photos/x/download'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('abort and offline', () => {
  it('throws ABORTED without fetching when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(getRandomPhotos({ signal: controller.signal })).rejects.toMatchObject({ code: 'ABORTED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps an abort during fetch to ABORTED', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const promise = searchPhotos({ query: 'forest', signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'ABORTED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops retrying when aborted during backoff', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => textResponse('down', { status: 500 }));
    const promise = getRandomPhotos({ signal: controller.signal }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.runAllTimersAsync();
    const err = await promise;
    expect(err.code).toBe('ABORTED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws OFFLINE when navigator reports offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await expect(getRandomPhotos()).rejects.toMatchObject({ code: 'OFFLINE' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('response validation', () => {
  it('normalizes a photo defensively', () => {
    const photo = normalizePhoto(rawPhoto());
    expect(photo).toEqual({
      photoId: 'abc123',
      width: 6000,
      height: 4000,
      color: '#A7A2A1',
      description: 'A quiet lake',
      urls: rawPhoto().urls,
      photographer: {
        name: 'Jane Doe',
        username: 'jane',
        profileUrl: 'https://unsplash.com/@jane?utm_source=iweb&utm_medium=referral',
      },
      photoPageUrl: 'https://unsplash.com/photos/abc123?utm_source=iweb&utm_medium=referral',
      downloadLocation: 'https://api.unsplash.com/photos/abc123/download?ixid=xyz',
      tags: ['Mountain', 'Lake'],
    });
  });

  it('rejects photos without an id or a valid raw URL', () => {
    expect(normalizePhoto(rawPhoto('abc', { id: undefined }))).toBeNull();
    expect(normalizePhoto(rawPhoto('bad id!'))).toBeNull();
    expect(normalizePhoto(rawPhoto('abc', { urls: {} }))).toBeNull();
    expect(normalizePhoto(rawPhoto('abc', { urls: { raw: 'http://images.unsplash.com/x' } }))).toBeNull();
    expect(normalizePhoto(rawPhoto('abc', { urls: { raw: 'https://evil.example.com/x.jpg' } }))).toBeNull();
    expect(normalizePhoto(rawPhoto('abc', { urls: { raw: 'https://unsplash.com.evil.io/x' } }))).toBeNull();
    expect(normalizePhoto(null)).toBeNull();
  });

  it('drops unsafe optional fields and caps strings', () => {
    const photo = normalizePhoto(rawPhoto('abc', {
      color: 'red;background:url(x)',
      description: 'x'.repeat(1000),
      links: { html: 'javascript:alert(1)', download_location: 'https://evil.example.com/track' },
      user: { name: '<b>Bob</b>', username: 'bob', links: { html: 'https://evil.example.com/@bob' } },
    }));
    expect(photo.color).toBeNull();
    expect(photo.description).toHaveLength(300);
    expect(photo.photoPageUrl).toBe('https://unsplash.com/photos/abc?utm_source=iweb&utm_medium=referral');
    expect(photo.downloadLocation).toBe('https://api.unsplash.com/photos/abc/download');
    expect(photo.photographer.name).toBe('<b>Bob</b>');
    expect(photo.photographer.profileUrl).toBe('https://unsplash.com/@bob?utm_source=iweb&utm_medium=referral');
  });

  it('filters malformed photos out of API results', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([rawPhoto('good1'), { id: 'nourls' }, rawPhoto('good1'), 'junk']));
    const photos = await getRandomPhotos();
    expect(photos.map((p) => p.photoId)).toEqual(['good1']);
  });

  it('rejects unexpected response shapes with BAD_RESPONSE', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'single' }));
    await expect(getRandomPhotos()).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: 'nope' }));
    await expect(searchPhotos({ query: 'x' })).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }));
    await expect(getRandomPhotos()).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('parses search results', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ total: 133, total_pages: 7, results: [rawPhoto('s1')] }));
    const res = await searchPhotos({ query: 'office', page: 2, perPage: 50 });
    const parsed = new URL(fetchMock.mock.calls[0][0]);
    expect(parsed.searchParams.get('path')).toBe('/search/photos');
    expect(parsed.searchParams.get('page')).toBe('2');
    expect(parsed.searchParams.get('per_page')).toBe('30');
    expect(res).toMatchObject({ total: 133, totalPages: 7 });
    expect(res.results[0].photoId).toBe('s1');
  });
});

describe('queries, tracking and utm', () => {
  it('validates queries', () => {
    expect(normalizeQuery('  a \t b\n c ')).toBe('a b c');
    expect(normalizeQuery('x'.repeat(150))).toHaveLength(100);
    expect(() => normalizeQuery('   ')).toThrow(UnsplashError);
    expect(() => normalizeQuery(42)).toThrow(expect.objectContaining({ code: 'INVALID_QUERY' }));
  });

  it('rejects an empty search without an API call', async () => {
    await expect(searchPhotos({ query: '  ' })).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tracks downloads through the proxy, keeping the download location params', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ url: 'https://image.unsplash.com/example' }));
    await trackDownload('https://api.unsplash.com/photos/abc/download?ixid=xyz');
    const parsed = new URL(fetchMock.mock.calls[0][0]);
    expect(parsed.origin + parsed.pathname).toBe(PROXY);
    expect(parsed.searchParams.get('path')).toBe('/photos/abc/download');
    expect(parsed.searchParams.get('ixid')).toBe('xyz');
  });

  it('refuses to send credentials to a non-API host', async () => {
    await expect(trackDownload('https://evil.example.com/photos/abc/download'))
      .rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    await expect(trackDownload('https://images.unsplash.com/photo-1')).rejects.toBeInstanceOf(UnsplashError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('appends utm parameters', () => {
    expect(withUtm('https://unsplash.com/@jane')).toBe('https://unsplash.com/@jane?utm_source=iweb&utm_medium=referral');
    expect(withUtm('https://unsplash.com/?utm_source=old&a=1')).toBe('https://unsplash.com/?utm_source=iweb&a=1&utm_medium=referral');
    vi.stubEnv('VITE_UNSPLASH_APP_NAME', 'My App');
    expect(withUtm('https://unsplash.com/')).toBe('https://unsplash.com/?utm_source=my_app&utm_medium=referral');
    vi.stubEnv('VITE_UNSPLASH_APP_NAME', '');
    expect(withUtm('https://unsplash.com/')).toContain('utm_source=iweb');
    expect(withUtm('javascript:alert(1)')).toBe('');
    expect(withUtm('not a url')).toBe('');
  });
});
