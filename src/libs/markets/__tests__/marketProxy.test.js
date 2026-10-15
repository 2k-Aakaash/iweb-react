import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeChart, normalizeSearch, normalizeSpark, proxyMarket } from '../../../../api/_marketProxy.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const q = (params) => new URLSearchParams(params);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizers', () => {
  it('normalizes spark entries, dropping null points and bad symbols', () => {
    const out = normalizeSpark({
      '^NSEI': { timestamp: [1, 2, 3], close: [100, null, 102], chartPreviousClose: 99, start: 0, end: 10 },
      'bad symbol!': { timestamp: [1], close: [5], chartPreviousClose: 4 },
      'EMPTY.NS': { timestamp: [], close: [] },
    });
    expect(Object.keys(out)).toEqual(['^NSEI']);
    expect(out['^NSEI']).toEqual({
      symbol: '^NSEI',
      price: 102,
      previousClose: 99,
      session: { start: 0, end: 10 },
      points: [[1, 100], [3, 102]],
    });
  });

  it('separates the real previous close from the range baseline', () => {
    const data = (meta) => ({
      chart: {
        result: [{
          meta: { symbol: '^NSEI', longName: 'NIFTY 50', currency: 'INR', regularMarketPrice: 22850, regularMarketChangePercent: 1.2, ...meta },
          timestamp: [1, 2],
          indicators: { quote: [{ open: [null, 22600], close: [22700, 22850] }] },
        }],
      },
    });
    const day = normalizeChart(data({ previousClose: 22622, chartPreviousClose: 22622 }), '1d');
    expect(day.meta).toMatchObject({ previousClose: 22622, rangeBaseline: 22622, open: 22600, dayChangePercent: 1.2, name: 'NIFTY 50' });
    expect(day.points).toEqual([[1, 22700], [2, 22850]]);

    const year = normalizeChart(data({ chartPreviousClose: 25323 }), '1y');
    expect(year.meta).toMatchObject({ previousClose: null, rangeBaseline: 25323, open: null });
    expect(normalizeChart({ chart: { result: [] } })).toBeNull();
  });

  it('keeps only supported search result types with valid symbols', () => {
    const results = normalizeSearch({
      quotes: [
        { symbol: 'RELIANCE.NS', quoteType: 'EQUITY', longname: 'Reliance Industries Limited', exchDisp: 'NSE' },
        { symbol: 'NEWS1', quoteType: 'NEWS' },
        { symbol: 'bad sym', quoteType: 'EQUITY' },
        { symbol: '^NSEI', quoteType: 'INDEX', shortname: 'NIFTY 50', exchange: 'NSI' },
      ],
    });
    expect(results).toEqual([
      { symbol: 'RELIANCE.NS', name: 'Reliance Industries Limited', exchange: 'NSE', type: 'EQUITY' },
      { symbol: '^NSEI', name: 'NIFTY 50', exchange: 'NSI', type: 'INDEX' },
    ]);
  });
});

describe('proxyMarket', () => {
  it.each([
    [{ op: 'nope' }, 'BAD_OP'],
    [{ op: 'spark', symbols: '' }, 'BAD_SYMBOLS'],
    [{ op: 'spark', symbols: '../etc', range: '1d' }, 'BAD_SYMBOLS'],
    [{ op: 'spark', symbols: Array.from({ length: 21 }, (_, i) => `S${i}`).join(','), range: '1d' }, 'BAD_SYMBOLS'],
    [{ op: 'spark', symbols: '^NSEI', range: '10y' }, 'BAD_RANGE'],
    [{ op: 'chart', symbol: 'https://evil', range: '1d' }, 'BAD_SYMBOLS'],
    [{ op: 'chart', symbol: '^NSEI', range: '2y' }, 'BAD_RANGE'],
    [{ op: 'search', q: '' }, 'BAD_QUERY'],
    [{ op: 'search', q: 'x'.repeat(41) }, 'BAD_QUERY'],
  ])('rejects %j without calling upstream', async (params, code) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await proxyMarket(q(params));
    expect(result.status).toBe(400);
    expect(JSON.parse(result.body).error.code).toBe(code);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls Yahoo spark with a browser User-Agent and caches at the CDN', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      '^NSEI': { timestamp: [1], close: [100], chartPreviousClose: 99, start: 0, end: 10 },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await proxyMarket(q({ op: 'spark', symbols: '^NSEI,^NSEI', range: '1d' }));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/v8/finance/spark');
    expect(new URL(url).searchParams.get('symbols')).toBe('^NSEI');
    expect(init.headers['User-Agent']).toMatch(/Mozilla/);
    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toMatch(/s-maxage=60/);
    expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(JSON.parse(result.body).quotes['^NSEI'].price).toBe(100);
  });

  it('uses a longer CDN cache for long chart ranges and maps the interval server-side', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      chart: { result: [{ meta: { symbol: 'TCS.NS', regularMarketPrice: 1 }, timestamp: [1], indicators: { quote: [{ close: [1] }] } }] },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await proxyMarket(q({ op: 'chart', symbol: 'TCS.NS', range: '5y' }));
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('interval')).toBe('1wk');
    expect(result.headers['cache-control']).toMatch(/s-maxage=1800/);
  });

  it('maps upstream rate limiting to 503 RATE_LIMITED with Retry-After', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Too Many Requests', { status: 429 })));
    const result = await proxyMarket(q({ op: 'chart', symbol: '^NSEI', range: '1d' }));
    expect(result.status).toBe(503);
    expect(result.headers['Retry-After']).toBe('60');
    expect(JSON.parse(result.body).error.code).toBe('RATE_LIMITED');
    expect(result.headers['cache-control']).toBe('no-store');
  });

  it('maps a Yahoo chart error body to 404 NOT_FOUND', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ chart: { result: null, error: { code: 'Not Found' } } })));
    const result = await proxyMarket(q({ op: 'chart', symbol: 'NOPE.NS', range: '1d' }));
    expect(result.status).toBe(404);
  });

  it('reports an unreachable upstream as 502 without leaking details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('getaddrinfo ENOTFOUND')));
    const result = await proxyMarket(q({ op: 'search', q: 'tcs' }));
    expect(result.status).toBe(502);
    expect(result.body).not.toContain('ENOTFOUND');
  });
});
