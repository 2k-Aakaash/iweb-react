import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyUnsplash } from '../../../../api/_unsplashProxy.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('server-side Unsplash proxy', () => {
  it('adds the access key server-side and forwards params and rate-limit headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', {
      status: 200,
      headers: { 'content-type': 'application/json', 'X-Ratelimit-Remaining': '49' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await proxyUnsplash(new URLSearchParams('path=/photos/random&query=fog&count=10'), 'secret-key');

    const [target, init] = fetchMock.mock.calls[0];
    expect(String(target)).toBe('https://api.unsplash.com/photos/random?query=fog&count=10');
    expect(init.headers.Authorization).toBe('Client-ID secret-key');
    expect(result.status).toBe(200);
    expect(result.headers['x-ratelimit-remaining']).toBe('49');
    expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(result.body).not.toContain('secret-key');
  });

  it('allows the download-tracking endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    const result = await proxyUnsplash(new URLSearchParams('path=/photos/AbC_1-2/download&ixid=x'), 'k');
    expect(result.status).toBe(200);
  });

  it.each(['/me', '/photos/random/../../me', '/users/x', '', 'https://evil.test/x'])(
    'rejects non-allowlisted path %j without calling Unsplash',
    async (path) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const result = await proxyUnsplash(new URLSearchParams({ path }), 'k');
      expect(result.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('reports a missing key as "not configured"', async () => {
    const result = await proxyUnsplash(new URLSearchParams('path=/photos/random'), '');
    expect(result.status).toBe(500);
    expect(result.body).toMatch(/not configured/i);
  });
});
