import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeDomain, proxyFavicon } from '../../../../api/_faviconProxy.js';

// A PNG header claiming the given width (enough for the size check).
function pngOf(width) {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes[16] = (width >>> 24) & 255;
  bytes[17] = (width >>> 16) & 255;
  bytes[18] = (width >>> 8) & 255;
  bytes[19] = width & 255;
  return new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('favicon proxy', () => {
  it('accepts plain hostnames only', () => {
    expect(normalizeDomain('WWW.Reddit.com')).toBe('reddit.com');
    expect(normalizeDomain('sub.example.co.in')).toBe('sub.example.co.in');
    for (const bad of ['', 'localhost', 'example.com/path', 'http://x.com', '127.0.0.1:80', 'a..com']) {
      expect(normalizeDomain(bad)).toBeNull();
    }
  });

  it('rejects an invalid domain without calling upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await proxyFavicon(new URLSearchParams('domain=../etc'));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips Google's 16px globe for a better icon, with CORS and a week of CDN cache", async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(pngOf(16)) // google: generic globe
      .mockResolvedValueOnce(pngOf(64))); // duckduckgo
    const res = await proxyFavicon(new URLSearchParams('domain=example.com'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(res.headers['cache-control']).toContain('s-maxage=604800');
    expect(res.body[19]).toBe(64);
  });

  it('falls back to a small icon when nothing better exists, and 404s when there is none', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(pngOf(16))
      .mockResolvedValueOnce(new Response('nope', { status: 404 }))
      .mockRejectedValueOnce(new TypeError('down')));
    expect((await proxyFavicon(new URLSearchParams('domain=tiny.com'))).status).toBe(200);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));
    expect((await proxyFavicon(new URLSearchParams('domain=none.com'))).status).toBe(404);
  });
});
