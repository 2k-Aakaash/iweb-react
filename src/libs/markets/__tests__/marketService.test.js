import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_WATCHLIST,
  METAL_PREFS_EVENT,
  WATCHLIST_EVENT,
  addToWatchlist,
  combineSeries,
  displayCurrency,
  formatChange,
  formatChangePercent,
  formatPrice,
  getChart,
  getMetalQuotes,
  getQuotes,
  getSessionState,
  getWatchlist,
  isLiveSession,
  metalPrice,
  removeFromWatchlist,
  retailFactor,
  searchSymbols,
  setMetalPrefs,
  setWatchlist,
} from '../marketService.js';

const OUNCE = 31.1034768;
const NOW = Date.UTC(2026, 9, 15, 6, 0, 0); // 11:30 IST
const OPEN_SESSION = { start: NOW / 1000 - 3600, end: NOW / 1000 + 3600 };
const CLOSED_SESSION = { start: NOW / 1000 - 7200, end: NOW / 1000 - 3600 };

let store;
let fetchMock;
let events;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function sparkBody(entries) {
  return { quotes: entries };
}

function entry(price, previousClose, session = OPEN_SESSION, points = [[NOW / 1000 - 60, price]]) {
  return { price, previousClose, session, points };
}

// Routes /api/market?op=… calls to handlers; anything else is a 404.
function routeFetch(handlers) {
  fetchMock.mockImplementation(async (url) => {
    const u = new URL(url);
    const handler = handlers[u.searchParams.get('op')] || handlers[u.hostname];
    return handler ? handler(u) : jsonResponse({ error: { code: 'NOT_FOUND' } }, 404);
  });
}

beforeEach(() => {
  store = new Map();
  events = [];
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
  vi.stubGlobal('location', { protocol: 'http:', origin: 'http://localhost:5173' });
  vi.stubGlobal('window', { dispatchEvent: (e) => events.push(e) });
  vi.stubGlobal('CustomEvent', class { constructor(type, init) { this.type = type; this.detail = init?.detail; } });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('quotes', () => {
  it('computes change and direction for real symbols via the same-origin proxy', async () => {
    routeFetch({ spark: () => jsonResponse(sparkBody({ '^NSEI': entry(22880, 22622) })) });
    const quotes = await getQuotes(['^NSEI'], { now: NOW });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^http:\/\/localhost:5173\/api\/market\?op=spark/);
    expect(quotes['^NSEI']).toMatchObject({ name: 'NIFTY 50', price: 22880, previousClose: 22622, direction: 'up', currency: 'INR' });
    expect(quotes['^NSEI'].changePercent).toBeCloseTo(((22880 - 22622) / 22622) * 100);
  });

  it('prices GOLD in INR per gram from COMEX futures × USD/INR, including the FX move', async () => {
    routeFetch({
      spark: (u) => {
        expect(u.searchParams.get('symbols').split(',').sort()).toEqual(['GC=F', 'USDINR=X']);
        return jsonResponse(sparkBody({ 'GC=F': entry(4000, 3950), 'USDINR=X': entry(95, 94) }));
      },
    });
    const { GOLD } = await getQuotes(['GOLD'], { now: NOW });
    expect(GOLD.price).toBeCloseTo((4000 * 95) / OUNCE);
    expect(GOLD.previousClose).toBeCloseTo((3950 * 94) / OUNCE);
    expect(GOLD).toMatchObject({ unit: 'g', source: 'comex', direction: 'up', name: 'Gold' });
  });

  it('serves fresh cache without a request, using a longer TTL when the market is closed', async () => {
    routeFetch({ spark: () => jsonResponse(sparkBody({ 'TCS.NS': entry(3000, 2990, CLOSED_SESSION) })) });
    await getQuotes(['TCS.NS'], { now: NOW });
    await getQuotes(['TCS.NS'], { now: NOW + 5 * 60 * 1000 }); // 5 min later, closed → still fresh
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await getQuotes(['TCS.NS'], { now: NOW + 16 * 60 * 1000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes every minute while the market is open', async () => {
    routeFetch({ spark: () => jsonResponse(sparkBody({ 'TCS.NS': entry(3000, 2990, OPEN_SESSION) })) });
    await getQuotes(['TCS.NS'], { now: NOW });
    await getQuotes(['TCS.NS'], { now: NOW + 30 * 1000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await getQuotes(['TCS.NS'], { now: NOW + 61 * 1000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to stale cache when the network fails, and throws when nothing is cached', async () => {
    routeFetch({ spark: () => jsonResponse(sparkBody({ 'TCS.NS': entry(3000, 2990) })) });
    await getQuotes(['TCS.NS'], { now: NOW });
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const later = await getQuotes(['TCS.NS'], { now: NOW + 60 * 60 * 1000 });
    expect(later['TCS.NS']).toMatchObject({ price: 3000, stale: true });
    await expect(getQuotes(['INFY.NS'], { now: NOW })).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('maps proxy errors to MarketError codes', async () => {
    routeFetch({ spark: () => jsonResponse({ error: { code: 'RATE_LIMITED' } }, 503) });
    await expect(getQuotes(['^NSEI'], { now: NOW })).rejects.toMatchObject({ name: 'MarketError', code: 'RATE_LIMITED' });
  });
});

describe('charts', () => {
  it('converts metal charts to INR per gram and tags the source', async () => {
    const chart = (price, previousClose, points) => jsonResponse({
      meta: { symbol: 'X', price, previousClose, rangeBaseline: previousClose, session: OPEN_SESSION },
      points,
    });
    routeFetch({
      chart: (u) => (u.searchParams.get('symbol') === 'GC=F'
        ? chart(4000, 3900, [[100, 3950], [200, 4000]])
        : chart(95, 94, [[50, 94], [150, 95]])),
    });
    const result = await getChart('GOLD', '1d', { now: NOW });
    expect(result.meta).toMatchObject({ symbol: 'GOLD', currency: 'INR', unit: 'g', exchange: 'COMEX (converted)' });
    expect(result.meta.price).toBeCloseTo((4000 * 95) / OUNCE);
    expect(result.points[0][1]).toBeCloseTo((3950 * 94) / OUNCE); // FX at or before t=100
    expect(result.points[1][1]).toBeCloseTo((4000 * 95) / OUNCE);
  });

  it('rejects unsupported ranges', async () => {
    await expect(getChart('^NSEI', '2y')).rejects.toMatchObject({ code: 'BAD_RANGE' });
  });

  it('aligns series on the first series timestamps', () => {
    expect(combineSeries([[10, 2], [20, 3]], [[5, 10], [15, 20]], 0.5)).toEqual([[10, 10], [20, 30]]);
    expect(combineSeries([[1, 2]], [])).toEqual([]);
  });
});

describe('metals', () => {
  it('applies purity, grams and the retail duty + GST factor', () => {
    expect(retailFactor(6)).toBeCloseTo(1.06 * 1.03);
    expect(metalPrice(10000, { mode: 'spot' })).toBe(10000);
    expect(metalPrice(10000, { mode: 'spot', purity: '22K' })).toBeCloseTo(10000 * (22 / 24));
    expect(metalPrice(10000, { grams: 8, purity: '22K', dutyPct: 6 })).toBeCloseTo(10000 * (22 / 24) * 8 * 1.06 * 1.03);
    expect(metalPrice(null)).toBeNull();
  });

  it('falls back to the daily spot feed when the proxy is unavailable', async () => {
    routeFetch({
      spark: () => jsonResponse({ error: { code: 'UPSTREAM' } }, 502),
      'cdn.jsdelivr.net': (u) => {
        const code = u.pathname.endsWith('xau.json') ? 'xau' : 'xag';
        return jsonResponse({ date: '2026-10-14', [code]: { inr: code === 'xau' ? 394833.6 : 5618.1 } });
      },
    });
    const result = await getMetalQuotes({ now: NOW });
    expect(result.source).toBe('daily-spot');
    expect(result.GOLD.price).toBeCloseTo(394833.6 / OUNCE);
    expect(result.GOLD).toMatchObject({ source: 'daily-spot', date: '2026-10-14', points: [] });
  });
});

describe('metal fallback details', () => {
  const spotRoute = (u) => {
    const code = u.pathname.endsWith('xau.json') ? 'xau' : 'xag';
    return jsonResponse({ date: '2026-10-14', [code]: { inr: code === 'xau' ? 394833.6 : 5618.1 } });
  };

  it('falls back to daily spot when a COMEX price is missing', async () => {
    routeFetch({
      spark: () => jsonResponse(sparkBody({
        'GC=F': { price: null, previousClose: 3950, session: OPEN_SESSION, points: [] },
        'SI=F': entry(56, 55),
        'USDINR=X': entry(95, 94),
      })),
      'cdn.jsdelivr.net': spotRoute,
    });
    expect((await getMetalQuotes({ now: NOW })).source).toBe('daily-spot');
  });

  it('reports when the daily spot was really fetched, even from cache', async () => {
    routeFetch({ spark: () => jsonResponse({ error: { code: 'UPSTREAM' } }, 502), 'cdn.jsdelivr.net': spotRoute });
    await getMetalQuotes({ now: NOW });
    const later = await getMetalQuotes({ now: NOW + 60 * 60 * 1000 });
    expect(later.GOLD.fetchedAt).toBe(NOW);
  });
});

describe('metal prefs', () => {
  it('emits and returns validated values, not the raw patch', () => {
    const result = setMetalPrefs({ dutyPct: 999, mode: 'bogus', purity: '22K' });
    expect(result).toEqual({ mode: 'retail', dutyPct: 6, purity: '22K' });
    const event = events.find((e) => e.type === METAL_PREFS_EVENT);
    expect(event.detail).toEqual(result);
  });
});

describe('session state', () => {
  it('reports open, closed and unknown', () => {
    expect(getSessionState(OPEN_SESSION, NOW)).toBe('open');
    expect(getSessionState(CLOSED_SESSION, NOW)).toBe('closed');
    expect(getSessionState(null, NOW)).toBe('unknown');
  });
});

describe('watchlist', () => {
  it('defaults, dedupes, validates and emits change events', () => {
    expect(getWatchlist().map((i) => i.symbol)).toEqual(DEFAULT_WATCHLIST.map((i) => i.symbol));
    setWatchlist([{ symbol: 'TCS.NS', name: 'TCS' }, { symbol: 'TCS.NS' }, { symbol: 'bad sym' }, null]);
    expect(getWatchlist()).toEqual([{ symbol: 'TCS.NS', name: 'TCS' }]);
    addToWatchlist({ symbol: '^NSEI' });
    expect(getWatchlist().map((i) => i.symbol)).toEqual(['TCS.NS', '^NSEI']);
    removeFromWatchlist('TCS.NS');
    expect(getWatchlist()).toEqual([{ symbol: '^NSEI', name: 'NIFTY 50' }]);
    expect(events.filter((e) => e.type === WATCHLIST_EVENT)).toHaveLength(3);
  });
});

describe('search', () => {
  it('puts local index/metal matches first and Indian listings before others', async () => {
    routeFetch({
      search: () => jsonResponse({
        results: [
          { symbol: 'GOLD', name: 'Barrick Gold', exchange: 'NYSE', type: 'EQUITY' },
          { symbol: 'GOLDBEES.NS', name: 'Nippon Gold ETF', exchange: 'NSE', type: 'ETF' },
        ],
      }),
    });
    const results = await searchSymbols('gold', { now: NOW });
    expect(results.map((r) => r.symbol)).toEqual(['GOLD', 'GOLDBEES.NS']);
    expect(results[0]).toMatchObject({ type: 'METAL', name: 'Gold' });
  });

  it('matches local entries by word prefix, not substring', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect((await searchSymbols('nifty it', { now: NOW })).map((r) => r.symbol)).toEqual(['^CNXIT']);
    // "it" matches NIFTY IT, but not INDIA VIX through "volatility".
    expect((await searchSymbols('it', { now: NOW })).map((r) => r.symbol)).toEqual(['^CNXIT']);
    expect((await searchSymbols('nsei', { now: NOW })).map((r) => r.symbol)).toEqual(['^NSEI']);
  });

  it('still returns local matches when the search request fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const results = await searchSymbols('nifty', { now: NOW });
    expect(results.map((r) => r.symbol)).toEqual(['^NSEI', '^NSEBANK', '^CNXIT']);
  });
});

describe('formatting', () => {
  it('uses Indian grouping, compact lakhs and signed changes', () => {
    expect(formatPrice(126941.4)).toBe('₹1,26,941.40');
    expect(formatPrice(22852, { currency: null })).toBe('22,852.00');
    expect(formatPrice(180626, { compact: true })).toBe('₹1.81L');
    expect(formatChangePercent(0.856)).toBe('▲ 0.86%');
    expect(formatChangePercent(-1.2)).toBe('▼ 1.20%');
    expect(formatChangePercent(0)).toBe('0.00%');
    expect(formatChange(195.25)).toBe('+195.25');
    expect(formatChange(-12.4)).toBe('−12.40');
  });

  it('only labels INR for Indian listings, indices excluded', () => {
    expect(displayCurrency('^NSEI')).toBeNull();
    expect(displayCurrency('RELIANCE.NS')).toBe('INR');
    expect(displayCurrency('GOLD')).toBe('INR');
    expect(displayCurrency('AAPL')).toBeNull();
  });
});

describe('regressions', () => {
  it('treats the half hour after the close as live, so closing prices are picked up', () => {
    const justClosed = { start: NOW / 1000 - 7 * 3600, end: NOW / 1000 - 60 };
    const longClosed = { start: NOW / 1000 - 9 * 3600, end: NOW / 1000 - 2 * 3600 };
    expect(isLiveSession(justClosed, NOW)).toBe(true);
    expect(isLiveSession(longClosed, NOW)).toBe(false);
    expect(isLiveSession(OPEN_SESSION, NOW)).toBe(true);
  });

  it('refetches a quote cached just before the close instead of keeping it for 15 minutes', async () => {
    const closesSoon = { start: NOW / 1000 - 6 * 3600, end: NOW / 1000 + 30 };
    let price = 22939.95;
    routeFetch({ spark: () => jsonResponse(sparkBody({ '^NSEI': entry(price, 22622, closesSoon) })) });
    await getQuotes(['^NSEI'], { now: NOW });
    price = 22997.35; // final closing bar posted after the bell
    const later = await getQuotes(['^NSEI'], { now: NOW + 2 * 60 * 1000 });
    expect(later['^NSEI'].price).toBe(22997.35);
  });

  it('keeps remote search results to NSE/BSE listings', async () => {
    routeFetch({
      search: () => jsonResponse({
        results: [
          { symbol: 'INFY', name: 'Infosys Limited', exchange: 'NYSE', type: 'EQUITY' },
          { symbol: 'INFY.NS', name: 'Infosys Limited', exchange: 'NSE', type: 'EQUITY' },
          { symbol: 'INFY.BO', name: 'Infosys Limited', exchange: 'Bombay', type: 'EQUITY' },
        ],
      }),
    });
    expect((await searchSymbols('infosys', { now: NOW })).map((r) => r.symbol)).toEqual(['INFY.NS', 'INFY.BO']);
  });

  it('labels metal charts in IST and omits contract-specific 52-week figures', async () => {
    const chart = (price) => jsonResponse({
      meta: { symbol: 'X', price, previousClose: price, timezone: 'America/New_York', fiftyTwoWeekHigh: 99, fiftyTwoWeekLow: 1, session: OPEN_SESSION },
      points: [[100, price]],
    });
    routeFetch({ chart: (u) => chart(u.searchParams.get('symbol') === 'SI=F' ? 56 : 95) });
    const { meta } = await getChart('SILVER', '1d', { now: NOW });
    expect(meta).toMatchObject({ timezone: 'Asia/Kolkata', fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null });
  });

  it('says why a quote is stale: offline vs a failing data source', async () => {
    routeFetch({ spark: () => jsonResponse(sparkBody({ 'TCS.NS': entry(3000, 2990) })) });
    await getQuotes(['TCS.NS'], { now: NOW });
    routeFetch({ spark: () => jsonResponse({ error: { code: 'UPSTREAM' } }, 502) });
    const failed = await getQuotes(['TCS.NS'], { now: NOW + 60 * 60 * 1000 });
    expect(failed['TCS.NS']).toMatchObject({ stale: true, staleReason: 'error' });
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const offline = await getQuotes(['TCS.NS'], { now: NOW + 2 * 60 * 60 * 1000 });
    expect(offline['TCS.NS']).toMatchObject({ stale: true, staleReason: 'offline' });
  });
});
