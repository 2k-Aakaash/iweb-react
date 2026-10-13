import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ACCEPTED_LOCAL_TYPES,
  pickUnsplashUrl,
  fetchImageBlob,
  makeThumbnail,
  sha256Hex,
  ImageLoadError,
} from '../imageLoader.js';

const urls = {
  raw: 'https://images.unsplash.com/photo-123?ixid=abc',
  full: 'https://images.unsplash.com/photo-123?ixid=abc&fm=jpg&q=80',
};

function widthOf(url) {
  return Number(new URL(url).searchParams.get('w'));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ACCEPTED_LOCAL_TYPES', () => {
  it('keeps the existing formats', () => {
    expect(ACCEPTED_LOCAL_TYPES).toEqual(['image/jpeg', 'image/png', 'image/gif']);
  });
});

describe('pickUnsplashUrl', () => {
  it('builds a raw URL with imgix params and keeps ixid', () => {
    const url = new URL(pickUnsplashUrl(urls, { width: 1920, height: 1080, dpr: 1 }));
    expect(url.origin + url.pathname).toBe('https://images.unsplash.com/photo-123');
    expect(url.searchParams.get('ixid')).toBe('abc');
    expect(url.searchParams.get('w')).toBe('1920');
    expect(url.searchParams.get('q')).toBe('80');
    expect(url.searchParams.get('fm')).toBe('jpg');
    expect(url.searchParams.get('fit')).toBe('max');
  });

  it('uses the long edge × dpr rounded up to a 320px step', () => {
    expect(widthOf(pickUnsplashUrl(urls, { width: 1366, height: 768, dpr: 1 }))).toBe(1600);
    expect(widthOf(pickUnsplashUrl(urls, { width: 800, height: 1280, dpr: 1.5 }))).toBe(1920);
    expect(widthOf(pickUnsplashUrl(urls, { width: 100, height: 100, dpr: 1 }))).toBe(320);
  });

  it('caps the width at 3840', () => {
    expect(widthOf(pickUnsplashUrl(urls, { width: 2560, height: 1440, dpr: 2 }))).toBe(3840);
    expect(widthOf(pickUnsplashUrl(urls, { width: 7680, height: 4320, dpr: 3 }))).toBe(3840);
  });

  it('never upscales beyond the photo width', () => {
    expect(widthOf(pickUnsplashUrl(urls, { width: 2560, height: 1440, dpr: 2, photoWidth: 3000 }))).toBe(3000);
    expect(widthOf(pickUnsplashUrl(urls, { width: 1920, height: 1080, dpr: 1, photoWidth: 6000 }))).toBe(1920);
    expect(widthOf(pickUnsplashUrl(urls, { width: 1920, height: 1080, dpr: 1, photoWidth: null }))).toBe(1920);
  });

  it('falls back to the window size and a sane default outside the browser', () => {
    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('innerHeight', 720);
    vi.stubGlobal('devicePixelRatio', 2);
    expect(widthOf(pickUnsplashUrl(urls))).toBe(2560);
  });

  it('ignores non-Unsplash or insecure URLs', () => {
    expect(pickUnsplashUrl({ raw: 'https://evil.example.com/x' })).toBe('');
    expect(pickUnsplashUrl({ raw: 'http://images.unsplash.com/x', full: urls.full })).toBe(urls.full);
    expect(pickUnsplashUrl(null)).toBe('');
  });
});

describe('fetchImageBlob', () => {
  function imageResponse(bytes, headers = {}) {
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg', ...headers },
    });
  }

  it('returns a typed blob for a valid image', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse(10)));
    const blob = await fetchImageBlob('https://images.unsplash.com/photo-1?w=10');
    expect(blob.size).toBe(10);
    expect(blob.type).toBe('image/jpeg');
  });

  it('rejects non-OK responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));
    await expect(fetchImageBlob('https://images.unsplash.com/x')).rejects.toMatchObject({ code: 'HTTP', status: 404 });
  });

  it('rejects non-image and SVG content types', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })));
    await expect(fetchImageBlob('https://images.unsplash.com/x')).rejects.toMatchObject({ code: 'NOT_IMAGE' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<svg/>', {
      status: 200,
      headers: { 'Content-Type': 'image/svg+xml' },
    })));
    await expect(fetchImageBlob('https://images.unsplash.com/x')).rejects.toMatchObject({ code: 'NOT_IMAGE' });
  });

  it('rejects by declared Content-Length and by actual size', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse(10, { 'Content-Length': '5000' })));
    await expect(fetchImageBlob('https://images.unsplash.com/x', { maxBytes: 100 }))
      .rejects.toMatchObject({ code: 'TOO_LARGE' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse(200)));
    await expect(fetchImageBlob('https://images.unsplash.com/x', { maxBytes: 100 }))
      .rejects.toBeInstanceOf(ImageLoadError);
  });

  it('rejects empty bodies and insecure URLs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse(0)));
    await expect(fetchImageBlob('https://images.unsplash.com/x')).rejects.toMatchObject({ code: 'EMPTY' });
    await expect(fetchImageBlob('http://images.unsplash.com/x')).rejects.toMatchObject({ code: 'INVALID_URL' });
  });

  it('rethrows aborts unchanged', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const promise = fetchImageBlob('https://images.unsplash.com/x', { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('makeThumbnail and sha256Hex', () => {
  it('returns null where createImageBitmap is unavailable', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    await expect(makeThumbnail(new Blob([new Uint8Array(4)], { type: 'image/jpeg' }))).resolves.toBeNull();
  });

  it('hashes blob contents', async () => {
    const hash = await sha256Hex(new Blob(['abc']));
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
