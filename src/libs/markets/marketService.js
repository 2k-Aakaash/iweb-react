// Market data for the Gold & Silver card, the Markets card, the Markets app and Spotlight.
//
// Live data comes from our /api/market proxy (Yahoo Finance, unofficial; see
// api/_marketProxy.js). Gold and silver are "virtual" symbols (GOLD, SILVER) priced in
// INR per gram from COMEX futures (GC=F, SI=F) × USD/INR; when the proxy is unavailable
// they fall back to a daily spot feed (fawazahmed0 currency-api on jsDelivr, no key).
// Everything is cached in localStorage, so tabs share results and cards still show the
// last known values offline. Data is delayed and for information only.

import { apiUrl } from '../apiBase.js';

// ---------------------------------------------------------------------------
// Constants

const TROY_OUNCE_GRAMS = 31.1034768;
const FX_SYMBOL = 'USDINR=X';
const SPARK_BATCH = 20;

export const GST_PCT = 3;
// Indian customs duty on gold/silver (5% BCD + 1% AIDC since the July 2024 budget).
// Editable by the user because it changes with budgets.
export const DEFAULT_DUTY_PCT = 6;
export const SOVEREIGN_GRAMS = 8;
export const PURITIES = [
  { id: '24K', label: '24K', factor: 1 },
  { id: '22K', label: '22K', factor: 22 / 24 },
  { id: '18K', label: '18K', factor: 18 / 24 },
];

export const METALS = {
  GOLD: { symbol: 'GOLD', name: 'Gold', futures: 'GC=F', spotCode: 'xau' },
  SILVER: { symbol: 'SILVER', name: 'Silver', futures: 'SI=F', spotCode: 'xag' },
};

export const DEFAULT_WATCHLIST = [
  { symbol: '^NSEI', name: 'NIFTY 50' },
  { symbol: '^BSESN', name: 'SENSEX' },
  { symbol: '^NSEBANK', name: 'NIFTY BANK' },
  { symbol: '^CNXIT', name: 'NIFTY IT' },
  { symbol: 'GOLD', name: 'Gold' },
  { symbol: 'SILVER', name: 'Silver' },
  { symbol: 'RELIANCE.NS', name: 'Reliance Industries' },
  { symbol: 'TCS.NS', name: 'Tata Consultancy Services' },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank' },
  { symbol: 'INFY.NS', name: 'Infosys' },
];

// Friendly names for well-known symbols (the quote batch endpoint returns no names).
const KNOWN_NAMES = {
  '^NSEI': 'NIFTY 50',
  '^BSESN': 'SENSEX',
  '^NSEBANK': 'NIFTY BANK',
  '^CNXIT': 'NIFTY IT',
  '^INDIAVIX': 'INDIA VIX',
  GOLD: 'Gold',
  SILVER: 'Silver',
};

export const CHART_RANGES = [
  { id: '1d', label: '1D' },
  { id: '5d', label: '5D' },
  { id: '1mo', label: '1M' },
  { id: '6mo', label: '6M' },
  { id: 'ytd', label: 'YTD' },
  { id: '1y', label: '1Y' },
  { id: '5y', label: '5Y' },
];
const CHART_RANGE_IDS = new Set(CHART_RANGES.map((r) => r.id));

export const OPEN_EVENT = 'markets:open';
export const WATCHLIST_EVENT = 'markets:watchlist';
export const METAL_PREFS_EVENT = 'metals:prefs';
const WATCHLIST_KEY = 'marketsWatchlist';
const METAL_PREFS_KEY = 'metalPrefs';
const CACHE_PREFIX = 'mkt:';

const MINUTE = 60 * 1000;
const LIVE_TTL = MINUTE;
const CLOSED_TTL = 15 * MINUTE;
const LONG_CHART_TTL = 30 * MINUTE;
const SEARCH_TTL = 24 * 60 * MINUTE;
const SPOT_TTL = 6 * 60 * MINUTE;

export class MarketError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MarketError';
    this.code = code;
  }
}

export const isMetal = (symbol) => Object.prototype.hasOwnProperty.call(METALS, symbol);

// ---------------------------------------------------------------------------
// Storage helpers

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable: the value just isn't cached.
  }
}

function emit(name, detail) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, { detail }));
}

// ---------------------------------------------------------------------------
// Market hours

/** 'open' | 'closed' | 'unknown' for a trading session { start, end } (epoch seconds). */
export function getSessionState(session, now = Date.now()) {
  const start = session?.start;
  const end = session?.end;
  if (typeof start !== 'number' || typeof end !== 'number') return 'unknown';
  const t = now / 1000;
  return t >= start && t < end ? 'open' : 'closed';
}

// Closing prices settle after the bell (NSE's closing auction posts the final bar after
// 15:30), so the half hour after a session ends still counts as live.
const SETTLE_MS = 30 * MINUTE;

/** True while a session is open or within the settling window after it closes. */
export function isLiveSession(session, now = Date.now()) {
  if (getSessionState(session, now) === 'open') return true;
  const end = session?.end;
  return typeof end === 'number' && now >= end * 1000 && now < end * 1000 + SETTLE_MS;
}

function ttlFor(session, now) {
  return isLiveSession(session, now) ? LIVE_TTL : CLOSED_TTL;
}

// ---------------------------------------------------------------------------
// Proxy requests

export function isMarketConfigured() {
  return apiUrl('/api/market') !== null;
}

async function apiGet(params, { signal } = {}) {
  const url = apiUrl('/api/market');
  if (!url) throw new MarketError('NOT_CONFIGURED', 'Market data isn’t available in this build.');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new MarketError('OFFLINE', 'You’re offline.');
  }
  let res;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new MarketError('NETWORK', 'Couldn’t reach market data. Check your connection.');
  }
  let body;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const code = typeof body?.error?.code === 'string' ? body.error.code : 'UPSTREAM';
    const message = code === 'RATE_LIMITED'
      ? 'Market data is busy right now. Try again shortly.'
      : code === 'NOT_FOUND'
        ? 'Symbol not found.'
        : 'Market data is unavailable right now.';
    throw new MarketError(code, message);
  }
  if (!body || typeof body !== 'object') throw new MarketError('BAD_RESPONSE', 'Market data returned unexpected data.');
  return body;
}

// ---------------------------------------------------------------------------
// Quote assembly

function describeChange(price, previousClose) {
  if (typeof price !== 'number' || typeof previousClose !== 'number' || previousClose === 0) {
    return { change: null, changePercent: null, direction: 'flat' };
  }
  const change = price - previousClose;
  const changePercent = (change / previousClose) * 100;
  const direction = Math.abs(changePercent) < 0.005 ? 'flat' : change > 0 ? 'up' : 'down';
  return { change, changePercent, direction };
}

// Value of `series` at time t (last point at or before t; first point if t is earlier).
function valueAt(points, t) {
  if (!points.length) return null;
  let lo = 0;
  let hi = points.length - 1;
  if (t < points[0][0]) return points[0][1];
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (points[mid][0] <= t) lo = mid;
    else hi = mid - 1;
  }
  return points[lo][1];
}

/** Multiplies two time series point-by-point (aligned on `a`'s timestamps) and scales. */
export function combineSeries(a, b, scale = 1) {
  if (!Array.isArray(a) || !Array.isArray(b) || !b.length) return [];
  return a.map(([t, v]) => [t, v * valueAt(b, t) * scale]);
}

// USD per troy ounce → INR per gram.
const PER_GRAM = 1 / TROY_OUNCE_GRAMS;

// The quote batch endpoint has no currency: NSE/BSE listings, Indian indices and our
// metals are INR; anything else is left unknown (charts carry the real currency).
export function guessCurrency(symbol) {
  if (isMetal(symbol) || symbol.startsWith('^') || /\.(NS|BO)$/.test(symbol)) return 'INR';
  return null;
}

function buildQuote(symbol, raw, name, extra = {}) {
  const { change, changePercent, direction } = describeChange(raw.price, raw.previousClose);
  return {
    symbol,
    name: name || KNOWN_NAMES[symbol] || symbol,
    currency: guessCurrency(symbol),
    price: raw.price,
    previousClose: raw.previousClose,
    change,
    changePercent,
    direction,
    points: raw.points || [],
    session: raw.session || null,
    fetchedAt: raw.fetchedAt,
    stale: Boolean(raw.stale),
    staleReason: raw.stale ? (raw.staleReason || 'offline') : null,
    ...extra,
  };
}

function buildMetalQuote(symbol, futures, fx) {
  const price = futures.price !== null && fx.price !== null ? futures.price * fx.price * PER_GRAM : null;
  const previousClose = futures.previousClose !== null && fx.previousClose !== null
    ? futures.previousClose * fx.previousClose * PER_GRAM
    : null;
  return buildQuote(symbol, {
    price,
    previousClose,
    points: combineSeries(futures.points, fx.points, PER_GRAM),
    session: futures.session,
    fetchedAt: Math.min(futures.fetchedAt, fx.fetchedAt),
    stale: futures.stale || fx.stale,
  }, METALS[symbol].name, { unit: 'g', source: 'comex' });
}

// Fetches spark entries for real symbols, using fresh per-symbol cache entries first.
async function getSparkEntries(symbols, { signal, force = false, now = Date.now() } = {}) {
  const result = {};
  const missing = [];
  for (const symbol of symbols) {
    const cached = readJson(`${CACHE_PREFIX}spark:${symbol}`);
    if (!force && cached && now - cached.fetchedAt < ttlFor(cached.session, now)) result[symbol] = cached;
    else missing.push(symbol);
  }
  let failure = null;
  for (let i = 0; i < missing.length; i += SPARK_BATCH) {
    const batch = missing.slice(i, i + SPARK_BATCH);
    try {
      const body = await apiGet({ op: 'spark', symbols: batch.join(','), range: '1d' }, { signal });
      const quotes = body.quotes && typeof body.quotes === 'object' ? body.quotes : {};
      for (const symbol of batch) {
        const entry = quotes[symbol];
        if (!entry) continue;
        const stored = {
          price: typeof entry.price === 'number' ? entry.price : null,
          previousClose: typeof entry.previousClose === 'number' ? entry.previousClose : null,
          points: Array.isArray(entry.points) ? entry.points : [],
          session: entry.session || null,
          fetchedAt: now,
        };
        writeJson(`${CACHE_PREFIX}spark:${symbol}`, stored);
        result[symbol] = stored;
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      failure = err;
    }
  }
  // On failure, serve whatever (expired) cache exists, marked stale with the reason.
  const staleReason = failure && (failure.code === 'OFFLINE' || failure.code === 'NETWORK') ? 'offline' : 'error';
  for (const symbol of missing) {
    if (result[symbol]) continue;
    const cached = readJson(`${CACHE_PREFIX}spark:${symbol}`);
    if (cached) result[symbol] = { ...cached, stale: true, staleReason };
  }
  return { entries: result, failure };
}

/**
 * Latest quotes (with intraday points) for symbols, including the virtual GOLD/SILVER.
 * Returns { [symbol]: Quote }. Symbols with no live or cached data are omitted; throws
 * only when nothing at all could be returned.
 */
export async function getQuotes(symbols, { signal, force = false, now = Date.now(), names = {} } = {}) {
  const wanted = [...new Set(symbols)];
  const real = new Set();
  for (const symbol of wanted) {
    if (isMetal(symbol)) {
      real.add(METALS[symbol].futures);
      real.add(FX_SYMBOL);
    } else {
      real.add(symbol);
    }
  }
  const { entries, failure } = await getSparkEntries([...real], { signal, force, now });

  const quotes = {};
  for (const symbol of wanted) {
    if (isMetal(symbol)) {
      const futures = entries[METALS[symbol].futures];
      const fx = entries[FX_SYMBOL];
      if (futures && fx) quotes[symbol] = buildMetalQuote(symbol, futures, fx);
    } else if (entries[symbol]) {
      quotes[symbol] = buildQuote(symbol, entries[symbol], names[symbol]);
    }
  }
  if (!Object.keys(quotes).length && wanted.length) {
    throw failure || new MarketError('NOT_FOUND', 'No market data for these symbols.');
  }
  return quotes;
}

// ---------------------------------------------------------------------------
// Charts

function chartTtl(range, session, now) {
  return range === '1d' || range === '5d' ? ttlFor(session, now) : LONG_CHART_TTL;
}

async function getRawChart(symbol, range, { signal, force, now }) {
  const key = `${CACHE_PREFIX}chart:${symbol}:${range}`;
  const cached = readJson(key);
  if (!force && cached && now - cached.fetchedAt < chartTtl(range, cached.meta?.session, now)) return cached;
  try {
    const body = await apiGet({ op: 'chart', symbol, range }, { signal });
    if (!body.meta || !Array.isArray(body.points)) throw new MarketError('BAD_RESPONSE', 'Market data returned unexpected data.');
    const stored = { meta: body.meta, points: body.points, fetchedAt: now };
    writeJson(key, stored);
    return stored;
  } catch (err) {
    if (err?.name === 'AbortError' || err?.code === 'NOT_FOUND' || !cached) throw err;
    return { ...cached, stale: true };
  }
}

const scaleOrNull = (value, factor) => (typeof value === 'number' && typeof factor === 'number' ? value * factor : null);

/**
 * Chart for one symbol and range ('1d' … '5y'): { meta, points: [[t, value]], stale }.
 * Metals are converted to INR per gram (24K / fine silver).
 */
export async function getChart(symbol, range, { signal, force = false, now = Date.now() } = {}) {
  if (!CHART_RANGE_IDS.has(range)) throw new MarketError('BAD_RANGE', 'Unsupported range.');
  if (!isMetal(symbol)) {
    const chart = await getRawChart(symbol, range, { signal, force, now });
    return {
      meta: { ...chart.meta, name: KNOWN_NAMES[symbol] || chart.meta.name },
      points: chart.points,
      fetchedAt: chart.fetchedAt,
      stale: Boolean(chart.stale),
    };
  }

  const metal = METALS[symbol];
  const [futures, fx] = await Promise.all([
    getRawChart(metal.futures, range, { signal, force, now }),
    getRawChart(FX_SYMBOL, range, { signal, force, now }),
  ]);
  const fxNow = fx.meta.price;
  const fxPrev = fx.meta.previousClose ?? fxNow;
  const fxBase = fx.meta.rangeBaseline ?? fxNow;
  const m = futures.meta;
  return {
    meta: {
      symbol,
      name: metal.name,
      currency: 'INR',
      unit: 'g',
      exchange: 'COMEX (converted)',
      instrumentType: 'METAL',
      // Shown to an Indian audience: label metal charts in IST, not New York time.
      timezone: 'Asia/Kolkata',
      price: scaleOrNull(m.price, fxNow * PER_GRAM),
      previousClose: scaleOrNull(m.previousClose, fxPrev * PER_GRAM),
      rangeBaseline: scaleOrNull(m.rangeBaseline, fxBase * PER_GRAM),
      open: scaleOrNull(m.open, fxPrev * PER_GRAM),
      dayHigh: scaleOrNull(m.dayHigh, fxNow * PER_GRAM),
      dayLow: scaleOrNull(m.dayLow, fxNow * PER_GRAM),
      volume: null,
      // A futures contract's 52-week range is contract-specific, not the metal's: omit it.
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
      marketTime: m.marketTime,
      session: m.session,
    },
    points: combineSeries(futures.points, fx.points, PER_GRAM),
    fetchedAt: Math.min(futures.fetchedAt, fx.fetchedAt),
    stale: Boolean(futures.stale || fx.stale),
  };
}

// ---------------------------------------------------------------------------
// Search

function keywordsOf(text) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  // "^nsei" is also searchable as "nsei".
  return [...new Set(words.flatMap((word) => (word.startsWith('^') ? [word, word.slice(1)] : [word])))];
}

// Every query word must start a keyword word ("nifty it" → NIFTY IT; "it" ≠ "volatility").
function matchesKeywords(keywords, queryWords) {
  return queryWords.every((word) => keywords.some((keyword) => keyword.startsWith(word)));
}

const LOCAL_SEARCH = [
  ...DEFAULT_WATCHLIST.filter((item) => item.symbol.startsWith('^') || isMetal(item.symbol)).map((item) => ({
    ...item,
    exchange: isMetal(item.symbol) ? 'Metals' : item.symbol === '^BSESN' ? 'BSE' : 'NSE',
    type: isMetal(item.symbol) ? 'METAL' : 'INDEX',
    keywords: keywordsOf(`${item.name} ${item.symbol}`),
  })),
  { symbol: '^INDIAVIX', name: 'INDIA VIX', exchange: 'NSE', type: 'INDEX', keywords: keywordsOf('india vix volatility ^indiavix') },
];

const isIndianListing = (item) => /\.(NS|BO)$/.test(item.symbol) || item.exchange === 'NSE' || item.exchange === 'BSE';

/** Symbol search: local matches (indices, metals) first, then Indian listings, then others. */
export async function searchSymbols(query, { signal, now = Date.now() } = {}) {
  const q = (query || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return [];
  const queryWords = q.split(' ');
  const local = LOCAL_SEARCH.filter((item) => matchesKeywords(item.keywords, queryWords))
    .map((item) => ({ symbol: item.symbol, name: item.name, exchange: item.exchange, type: item.type }));

  const key = `${CACHE_PREFIX}search:${q}`;
  const cached = readJson(key);
  let remote = [];
  if (cached && now - cached.fetchedAt < SEARCH_TTL) {
    remote = cached.results;
  } else if (q.length >= 2) {
    try {
      const body = await apiGet({ op: 'search', q }, { signal });
      remote = Array.isArray(body.results) ? body.results : [];
      writeJson(key, { results: remote, fetchedAt: now });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      if (!local.length) throw err;
    }
  }
  const seen = new Set(local.map((item) => item.symbol));
  const rank = (item) => (isIndianListing(item) ? 0 : 1);
  // Indian listings only (NSE .NS / BSE .BO); local indices and metals are already included.
  const merged = remote
    .filter((item) => item && typeof item.symbol === 'string' && !seen.has(item.symbol) && isIndianListing(item))
    .sort((a, b) => rank(a) - rank(b));
  return [...local, ...merged].slice(0, 12);
}

// ---------------------------------------------------------------------------
// Watchlist

function normalizeWatchItem(item) {
  if (!item || typeof item.symbol !== 'string' || !/^[A-Za-z0-9^.=&_-]{1,24}$/.test(item.symbol)) return null;
  const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 80) : (KNOWN_NAMES[item.symbol] || item.symbol);
  return { symbol: item.symbol, name };
}

export function getWatchlist() {
  const stored = readJson(WATCHLIST_KEY);
  if (!Array.isArray(stored)) return DEFAULT_WATCHLIST.map((item) => ({ ...item }));
  const seen = new Set();
  return stored.map(normalizeWatchItem).filter((item) => item && !seen.has(item.symbol) && seen.add(item.symbol));
}

export function setWatchlist(list) {
  const seen = new Set();
  const next = (Array.isArray(list) ? list : [])
    .map(normalizeWatchItem)
    .filter((item) => item && !seen.has(item.symbol) && seen.add(item.symbol))
    .slice(0, 50);
  writeJson(WATCHLIST_KEY, next);
  emit(WATCHLIST_EVENT, next);
  return next;
}

export function addToWatchlist(item) {
  const list = getWatchlist();
  if (list.some((entry) => entry.symbol === item?.symbol)) return list;
  return setWatchlist([...list, item]);
}

export function removeFromWatchlist(symbol) {
  return setWatchlist(getWatchlist().filter((entry) => entry.symbol !== symbol));
}

/** Opens the Markets app (App listens for this event), optionally on a symbol. */
export function openMarkets(symbol) {
  emit(OPEN_EVENT, { symbol: symbol || null });
}

// ---------------------------------------------------------------------------
// Gold & silver pricing

const DEFAULT_METAL_PREFS = { mode: 'retail', dutyPct: DEFAULT_DUTY_PCT, purity: '24K' };

export function getMetalPrefs() {
  const stored = readJson(METAL_PREFS_KEY) || {};
  const duty = Number(stored.dutyPct);
  return {
    mode: stored.mode === 'spot' ? 'spot' : 'retail',
    dutyPct: Number.isFinite(duty) && duty >= 0 && duty <= 50 ? duty : DEFAULT_DUTY_PCT,
    purity: PURITIES.some((p) => p.id === stored.purity) ? stored.purity : DEFAULT_METAL_PREFS.purity,
  };
}

export function setMetalPrefs(patch) {
  writeJson(METAL_PREFS_KEY, { ...getMetalPrefs(), ...patch });
  // Emit (and return) the validated values, never the raw patch.
  const next = getMetalPrefs();
  emit(METAL_PREFS_EVENT, next);
  return next;
}

/** Multiplier from the international price to the Indian retail estimate (duty + GST). */
export function retailFactor(dutyPct = DEFAULT_DUTY_PCT) {
  return (1 + dutyPct / 100) * (1 + GST_PCT / 100);
}

/**
 * INR price for a quantity of metal.
 * inrPerGram: international price per gram of 24K gold / fine silver.
 * opts: { grams = 1, purity = '24K' (gold only), mode = 'retail' | 'spot', dutyPct }
 */
export function metalPrice(inrPerGram, { grams = 1, purity = '24K', mode = 'retail', dutyPct = DEFAULT_DUTY_PCT } = {}) {
  if (typeof inrPerGram !== 'number' || !Number.isFinite(inrPerGram)) return null;
  const purityFactor = PURITIES.find((p) => p.id === purity)?.factor ?? 1;
  const factor = mode === 'spot' ? 1 : retailFactor(dutyPct);
  return inrPerGram * purityFactor * grams * factor;
}

// --- Daily spot fallback (no key; used when the proxy is unavailable) ---

const SPOT_API = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api';

async function fetchSpotFile(code, date, { signal }) {
  const res = await fetch(`${SPOT_API}@${date}/v1/currencies/${code}.json`, { signal });
  if (!res.ok) throw new MarketError('UPSTREAM', `Spot price source error (HTTP ${res.status}).`);
  const body = await res.json();
  const inrPerOunce = Number(body?.[code]?.inr);
  if (!Number.isFinite(inrPerOunce) || inrPerOunce <= 0) throw new MarketError('BAD_RESPONSE', 'Spot price source returned unexpected data.');
  return { date: typeof body.date === 'string' ? body.date : date, inrPerGram: inrPerOunce * PER_GRAM };
}

/**
 * Latest daily spot for GOLD and SILVER:
 * { GOLD: { inrPerGram, date }, SILVER: …, fetchedAt, stale } (fetchedAt = when it was really fetched).
 */
export async function getDailySpot({ signal, now = Date.now() } = {}) {
  const key = `${CACHE_PREFIX}spot`;
  const cached = readJson(key);
  if (cached && now - cached.fetchedAt < SPOT_TTL) return { ...cached.values, fetchedAt: cached.fetchedAt, stale: false };
  try {
    const [gold, silver] = await Promise.all([
      fetchSpotFile(METALS.GOLD.spotCode, 'latest', { signal }),
      fetchSpotFile(METALS.SILVER.spotCode, 'latest', { signal }),
    ]);
    const values = { GOLD: gold, SILVER: silver };
    writeJson(key, { values, fetchedAt: now });
    return { ...values, fetchedAt: now, stale: false };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    if (cached) return { ...cached.values, fetchedAt: cached.fetchedAt, stale: true };
    throw err instanceof MarketError ? err : new MarketError('NETWORK', 'Couldn’t load metal prices. Check your connection.');
  }
}

/**
 * Gold & silver quotes for the card: live COMEX-based quotes when possible, otherwise the
 * daily spot fallback (no intraday points). Returns { GOLD, SILVER, source, stale }.
 */
export async function getMetalQuotes({ signal, force = false, now = Date.now() } = {}) {
  try {
    const quotes = await getQuotes(['GOLD', 'SILVER'], { signal, force, now });
    const usable = (quote) => quote && typeof quote.price === 'number' && Number.isFinite(quote.price);
    if (usable(quotes.GOLD) && usable(quotes.SILVER)) {
      return { GOLD: quotes.GOLD, SILVER: quotes.SILVER, source: 'comex', stale: quotes.GOLD.stale || quotes.SILVER.stale };
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
  }
  const spot = await getDailySpot({ signal, now });
  const toQuote = (symbol) => buildQuote(symbol, {
    price: spot[symbol].inrPerGram,
    previousClose: null,
    points: [],
    session: null,
    fetchedAt: spot.fetchedAt,
    stale: spot.stale,
  }, METALS[symbol].name, { unit: 'g', source: 'daily-spot', date: spot[symbol].date });
  return { GOLD: toQuote('GOLD'), SILVER: toQuote('SILVER'), source: 'daily-spot', stale: spot.stale };
}

// ---------------------------------------------------------------------------
// Formatting (Indian grouping: ₹1,26,941.40, ₹1.81L)

const priceFormats = new Map();
function priceFormat(currency, compact, digits) {
  const key = `${currency}|${compact}|${digits}`;
  if (!priceFormats.has(key)) {
    priceFormats.set(key, new Intl.NumberFormat('en-IN', {
      style: currency ? 'currency' : 'decimal',
      currency: currency || undefined,
      notation: compact ? 'compact' : 'standard',
      minimumFractionDigits: compact ? 0 : digits,
      maximumFractionDigits: digits,
    }));
  }
  return priceFormats.get(key);
}

/** "₹22,852.00" / "22,852.00" (indices have no currency symbol) / "₹1.81L" when compact. */
export function formatPrice(value, { currency = 'INR', compact = false, digits = 2 } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return priceFormat(currency, compact, compact ? 2 : digits).format(value);
}

const percentFormat = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "▲ 0.86%" / "▼ 1.20%" / "0.00%". */
export function formatChangePercent(changePercent) {
  if (typeof changePercent !== 'number' || !Number.isFinite(changePercent)) return '—';
  const text = `${percentFormat.format(Math.abs(changePercent))}%`;
  if (Math.abs(changePercent) < 0.005) return text;
  return `${changePercent > 0 ? '▲' : '▼'} ${text}`;
}

/** "+195.25" / "−12.40" (true minus sign). */
export function formatChange(change, { digits = 2 } = {}) {
  if (typeof change !== 'number' || !Number.isFinite(change)) return '—';
  const text = priceFormat(null, false, digits).format(Math.abs(change));
  if (Math.abs(change) < 10 ** -digits / 2) return text;
  return `${change > 0 ? '+' : '−'}${text}`;
}

/** Indices are shown without a currency symbol, like the exchanges do. */
export function displayCurrency(symbol) {
  return symbol.startsWith('^') ? null : guessCurrency(symbol);
}
