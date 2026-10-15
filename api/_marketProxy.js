// Server-side market-data proxy (indices, stocks, metals), shared by the Vercel function
// (api/market.js) and the Vite dev-server middleware (vite.config.js).
//
// Upstream: Yahoo Finance's public chart/spark/search endpoints. They are unofficial and
// send no CORS headers, so the browser can't call them directly; this proxy calls them
// server-side, validates every input, returns a compact normalized shape and sets CDN
// cache headers so one upstream request serves every user for a short window.
// Files starting with "_" in /api are not deployed as their own Vercel functions.

const YAHOO = 'https://query1.finance.yahoo.com';
// Yahoo answers 429 to requests without a browser-like User-Agent.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const UPSTREAM_TIMEOUT_MS = 8000;

const SYMBOL_RE = /^[A-Za-z0-9^.=&_-]{1,24}$/;
const MAX_SPARK_SYMBOLS = 20;
const MAX_QUERY_LENGTH = 40;

// Chart ranges the UI offers → Yahoo interval. The client never picks intervals itself.
export const CHART_INTERVALS = {
  '1d': '5m',
  '5d': '30m',
  '1mo': '60m',
  '6mo': '1d',
  ytd: '1d',
  '1y': '1d',
  '5y': '1wk',
};
const SPARK_RANGES = { '1d': '15m', '5d': '60m' };
const SEARCH_TYPES = new Set(['EQUITY', 'INDEX', 'ETF', 'MUTUALFUND', 'FUTURE']);

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// Short CDN cache for live data, longer for slow-moving data. stale-while-revalidate
// keeps responses instant while the CDN refreshes in the background.
const CACHE_LIVE = 'public, max-age=30, s-maxage=60, stale-while-revalidate=300';
const CACHE_SLOW = 'public, max-age=300, s-maxage=1800, stale-while-revalidate=3600';
const CACHE_SEARCH = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400';

function json(status, body, cacheControl = 'no-store') {
  return {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': cacheControl, ...CORS_HEADERS },
    body: JSON.stringify(body),
  };
}

function error(status, code, message, extraHeaders = {}) {
  const result = json(status, { error: { code, message } });
  Object.assign(result.headers, extraHeaders);
  return result;
}

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const str = (value, max = 120) => (typeof value === 'string' ? value.trim().slice(0, max) : null);

// Pairs timestamps (seconds) with closes, dropping gaps Yahoo reports as null.
function toPoints(timestamps, closes) {
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return [];
  const points = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const t = num(timestamps[i]);
    const v = num(closes[i]);
    if (t !== null && v !== null) points.push([t, v]);
  }
  return points;
}

async function fetchUpstream(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Maps an upstream failure to a client-facing error (never forwards upstream bodies).
function upstreamError(res) {
  if (res.status === 429) {
    return error(503, 'RATE_LIMITED', 'Market data is busy right now. Try again shortly.', { 'Retry-After': '60' });
  }
  if (res.status === 404) return error(404, 'NOT_FOUND', 'Symbol not found.');
  return error(502, 'UPSTREAM', `Market data source error (HTTP ${res.status}).`);
}

async function getJson(url) {
  let res;
  try {
    res = await fetchUpstream(url);
  } catch {
    return { failure: error(502, 'UNREACHABLE', 'Could not reach the market data source.') };
  }
  if (!res.ok) return { failure: upstreamError(res) };
  try {
    return { data: await res.json() };
  } catch {
    return { failure: error(502, 'BAD_RESPONSE', 'Market data source returned invalid data.') };
  }
}

// --- spark: latest price + intraday line for several symbols in one call ---------------

export function normalizeSpark(data) {
  const out = {};
  if (!data || typeof data !== 'object') return out;
  for (const [key, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== 'object' || !SYMBOL_RE.test(key)) continue;
    const points = toPoints(entry.timestamp, entry.close);
    const previousClose = num(entry.chartPreviousClose) ?? num(entry.previousClose);
    const price = points.length ? points[points.length - 1][1] : null;
    if (price === null && previousClose === null) continue;
    out[key] = {
      symbol: key,
      price,
      previousClose,
      session: { start: num(entry.start), end: num(entry.end) },
      points,
    };
  }
  return out;
}

async function spark(query) {
  const symbols = (query.get('symbols') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!symbols.length || symbols.length > MAX_SPARK_SYMBOLS || !symbols.every((s) => SYMBOL_RE.test(s))) {
    return error(400, 'BAD_SYMBOLS', `Provide 1-${MAX_SPARK_SYMBOLS} valid symbols.`);
  }
  const range = query.get('range') || '1d';
  if (!SPARK_RANGES[range]) return error(400, 'BAD_RANGE', 'Unsupported range.');

  const url = new URL('/v8/finance/spark', YAHOO);
  url.searchParams.set('symbols', [...new Set(symbols)].join(','));
  url.searchParams.set('range', range);
  url.searchParams.set('interval', SPARK_RANGES[range]);
  const { data, failure } = await getJson(url);
  if (failure) return failure;
  return json(200, { quotes: normalizeSpark(data) }, CACHE_LIVE);
}

// --- chart: one symbol, one range, with quote metadata ----------------------------------

export function normalizeChart(data, range = '1d') {
  const result = data?.chart?.result?.[0];
  if (!result || typeof result !== 'object') return null;
  const meta = result.meta || {};
  const quote = result.indicators?.quote?.[0] || {};
  const regular = meta.currentTradingPeriod?.regular || {};
  const firstOpen = Array.isArray(quote.open) ? quote.open.find((v) => num(v) !== null) : null;
  return {
    meta: {
      symbol: str(meta.symbol, 24),
      name: str(meta.longName) || str(meta.shortName) || str(meta.symbol, 24),
      currency: str(meta.currency, 8),
      exchange: str(meta.fullExchangeName, 40) || str(meta.exchangeName, 40),
      instrumentType: str(meta.instrumentType, 20),
      timezone: str(meta.exchangeTimezoneName, 40),
      price: num(meta.regularMarketPrice),
      // Yahoo only sends the real previous close on 1-day charts; on longer ranges
      // chartPreviousClose is the close before the range starts (the range's baseline).
      previousClose: num(meta.previousClose),
      rangeBaseline: num(meta.chartPreviousClose),
      dayChangePercent: num(meta.regularMarketChangePercent),
      open: range === '1d' ? num(firstOpen) : null,
      dayHigh: num(meta.regularMarketDayHigh),
      dayLow: num(meta.regularMarketDayLow),
      volume: num(meta.regularMarketVolume),
      fiftyTwoWeekHigh: num(meta.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: num(meta.fiftyTwoWeekLow),
      marketTime: num(meta.regularMarketTime),
      session: { start: num(regular.start), end: num(regular.end) },
    },
    points: toPoints(result.timestamp, quote.close),
  };
}

async function chart(query) {
  const symbol = query.get('symbol') || '';
  if (!SYMBOL_RE.test(symbol)) return error(400, 'BAD_SYMBOLS', 'Invalid symbol.');
  const range = query.get('range') || '1d';
  const interval = CHART_INTERVALS[range];
  if (!interval) return error(400, 'BAD_RANGE', 'Unsupported range.');

  const url = new URL(`/v8/finance/chart/${encodeURIComponent(symbol)}`, YAHOO);
  url.searchParams.set('range', range);
  url.searchParams.set('interval', interval);
  url.searchParams.set('includePrePost', 'false');
  const { data, failure } = await getJson(url);
  if (failure) return failure;
  if (data?.chart?.error) return error(404, 'NOT_FOUND', 'Symbol not found.');
  const normalized = normalizeChart(data, range);
  if (!normalized) return error(502, 'BAD_RESPONSE', 'Market data source returned invalid data.');
  return json(200, normalized, range === '1d' || range === '5d' ? CACHE_LIVE : CACHE_SLOW);
}

// --- search: symbol lookup -----------------------------------------------------------

export function normalizeSearch(data) {
  const quotes = Array.isArray(data?.quotes) ? data.quotes : [];
  return quotes
    .filter((q) => SEARCH_TYPES.has(q?.quoteType) && typeof q.symbol === 'string' && SYMBOL_RE.test(q.symbol))
    .slice(0, 10)
    .map((q) => ({
      symbol: q.symbol,
      name: str(q.longname) || str(q.shortname) || q.symbol,
      exchange: str(q.exchDisp, 40) || str(q.exchange, 40),
      type: q.quoteType,
    }));
}

async function search(query) {
  const q = (query.get('q') || '').trim();
  if (!q || q.length > MAX_QUERY_LENGTH) return error(400, 'BAD_QUERY', 'Enter a search term.');
  const url = new URL('/v1/finance/search', YAHOO);
  url.searchParams.set('q', q);
  url.searchParams.set('quotesCount', '12');
  url.searchParams.set('newsCount', '0');
  url.searchParams.set('listsCount', '0');
  const { data, failure } = await getJson(url);
  if (failure) return failure;
  return json(200, { results: normalizeSearch(data) }, CACHE_SEARCH);
}

/**
 * @param {URLSearchParams} query  `op` = spark | chart | search, plus that op's params.
 * @returns {Promise<{ status: number, headers: Record<string,string>, body: string }>}
 */
export async function proxyMarket(query) {
  switch (query.get('op')) {
    case 'spark':
      return spark(query);
    case 'chart':
      return chart(query);
    case 'search':
      return search(query);
    default:
      return error(400, 'BAD_OP', 'Unsupported operation.');
  }
}
