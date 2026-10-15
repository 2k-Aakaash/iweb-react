// Currency conversion shared by the Smart Stack currency widget and Spotlight (Ctrl/Cmd+K).
//
// Data sources (free, no API key):
//   - Latest rates: ExchangeRate-API open access (https://open.er-api.com), 160+ currencies,
//     refreshed once a day. Attribution "Rates By Exchange Rate API" is required.
//   - 7-day trend: Frankfurter (ECB reference rates, ~30 major currencies). Pairs it
//     doesn't cover simply have no trend line.
// Responses are cached in localStorage, so every tab shares them and the widget still
// works offline with the last known rates.

const LATEST_API = 'https://open.er-api.com/v6/latest/';
const HISTORY_API = 'https://api.frankfurter.dev/v1/';

const RATES_CACHE_PREFIX = 'currencyRates:';
const HISTORY_CACHE_PREFIX = 'currencyHistory:';
const PREFS_KEY = 'currencyWidget';
const MIN_REFRESH_MS = 60 * 60 * 1000;

export const ATTRIBUTION = { label: 'Rates By Exchange Rate API', url: 'https://www.exchangerate-api.com' };

export const CURRENCIES = [
  { code: 'USD', name: 'US Dollar', flag: '🇺🇸' },
  { code: 'INR', name: 'Indian Rupee', flag: '🇮🇳' },
  { code: 'EUR', name: 'Euro', flag: '🇪🇺' },
  { code: 'GBP', name: 'British Pound', flag: '🇬🇧' },
  { code: 'AED', name: 'UAE Dirham', flag: '🇦🇪' },
  { code: 'SAR', name: 'Saudi Riyal', flag: '🇸🇦' },
  { code: 'QAR', name: 'Qatari Riyal', flag: '🇶🇦' },
  { code: 'KWD', name: 'Kuwaiti Dinar', flag: '🇰🇼' },
  { code: 'OMR', name: 'Omani Rial', flag: '🇴🇲' },
  { code: 'BHD', name: 'Bahraini Dinar', flag: '🇧🇭' },
  { code: 'SGD', name: 'Singapore Dollar', flag: '🇸🇬' },
  { code: 'MYR', name: 'Malaysian Ringgit', flag: '🇲🇾' },
  { code: 'JPY', name: 'Japanese Yen', flag: '🇯🇵' },
  { code: 'CNY', name: 'Chinese Yuan', flag: '🇨🇳' },
  { code: 'HKD', name: 'Hong Kong Dollar', flag: '🇭🇰' },
  { code: 'KRW', name: 'South Korean Won', flag: '🇰🇷' },
  { code: 'THB', name: 'Thai Baht', flag: '🇹🇭' },
  { code: 'IDR', name: 'Indonesian Rupiah', flag: '🇮🇩' },
  { code: 'PHP', name: 'Philippine Peso', flag: '🇵🇭' },
  { code: 'LKR', name: 'Sri Lankan Rupee', flag: '🇱🇰' },
  { code: 'NPR', name: 'Nepalese Rupee', flag: '🇳🇵' },
  { code: 'BDT', name: 'Bangladeshi Taka', flag: '🇧🇩' },
  { code: 'PKR', name: 'Pakistani Rupee', flag: '🇵🇰' },
  { code: 'AUD', name: 'Australian Dollar', flag: '🇦🇺' },
  { code: 'NZD', name: 'New Zealand Dollar', flag: '🇳🇿' },
  { code: 'CAD', name: 'Canadian Dollar', flag: '🇨🇦' },
  { code: 'CHF', name: 'Swiss Franc', flag: '🇨🇭' },
  { code: 'SEK', name: 'Swedish Krona', flag: '🇸🇪' },
  { code: 'NOK', name: 'Norwegian Krone', flag: '🇳🇴' },
  { code: 'DKK', name: 'Danish Krone', flag: '🇩🇰' },
  { code: 'PLN', name: 'Polish Złoty', flag: '🇵🇱' },
  { code: 'TRY', name: 'Turkish Lira', flag: '🇹🇷' },
  { code: 'RUB', name: 'Russian Ruble', flag: '🇷🇺' },
  { code: 'ZAR', name: 'South African Rand', flag: '🇿🇦' },
  { code: 'BRL', name: 'Brazilian Real', flag: '🇧🇷' },
  { code: 'MXN', name: 'Mexican Peso', flag: '🇲🇽' },
];

const CODES = new Set(CURRENCIES.map((c) => c.code));

// Words and symbols people type in Spotlight → ISO code.
const ALIASES = {
  $: 'USD', usd: 'USD', dollar: 'USD', dollars: 'USD', bucks: 'USD', 'us dollar': 'USD', 'us dollars': 'USD',
  '₹': 'INR', inr: 'INR', rs: 'INR', 'rs.': 'INR', rupee: 'INR', rupees: 'INR', 'indian rupee': 'INR', 'indian rupees': 'INR',
  '€': 'EUR', eur: 'EUR', euro: 'EUR', euros: 'EUR',
  '£': 'GBP', gbp: 'GBP', pound: 'GBP', pounds: 'GBP', 'british pound': 'GBP',
  '¥': 'JPY', yen: 'JPY', yuan: 'CNY', rmb: 'CNY', renminbi: 'CNY',
  dirham: 'AED', dirhams: 'AED', riyal: 'SAR', riyals: 'SAR', ringgit: 'MYR', baht: 'THB', won: 'KRW',
  'singapore dollar': 'SGD', 'singapore dollars': 'SGD', 'australian dollar': 'AUD', 'australian dollars': 'AUD',
  'canadian dollar': 'CAD', 'canadian dollars': 'CAD', franc: 'CHF', francs: 'CHF', lira: 'TRY', ruble: 'RUB', rubles: 'RUB',
  rand: 'ZAR', real: 'BRL', peso: 'MXN', pesos: 'MXN', taka: 'BDT', dinar: 'KWD',
};

export class CurrencyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CurrencyError';
    this.code = code;
  }
}

export function getCurrency(code) {
  return CURRENCIES.find((c) => c.code === code) || null;
}

/** Short symbol for badges ("$", "₹", "€", "AED"). Flag emoji don't render on Windows. */
export function getCurrencySymbol(code) {
  try {
    const part = new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find((p) => p.type === 'currency');
    return part?.value || code;
  } catch {
    return code;
  }
}

export function resolveCurrency(token) {
  if (!token) return null;
  const key = token.trim().toLowerCase();
  if (ALIASES[key]) return ALIASES[key];
  const upper = key.toUpperCase();
  return CODES.has(upper) ? upper : null;
}

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
    // Storage full or unavailable: rates are just not cached.
  }
}

const DEFAULT_PREFS = { amount: 1, from: 'USD', to: 'INR' };

export function getCurrencyPrefs() {
  const stored = readJson(PREFS_KEY) || {};
  const amount = Number(stored.amount);
  return {
    amount: Number.isFinite(amount) && amount >= 0 ? amount : DEFAULT_PREFS.amount,
    from: CODES.has(stored.from) ? stored.from : DEFAULT_PREFS.from,
    to: CODES.has(stored.to) ? stored.to : DEFAULT_PREFS.to,
  };
}

export const PREFS_EVENT = 'currency:prefs';

export function setCurrencyPrefs(patch) {
  const next = { ...getCurrencyPrefs(), ...patch };
  writeJson(PREFS_KEY, next);
  // Same-tab signal (e.g. Spotlight → widget); other tabs get the 'storage' event.
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: next }));
  return next;
}

// ---------------------------------------------------------------------------
// Rates

function isFresh(entry, now) {
  return entry && now < entry.nextUpdateAt && now - entry.fetchedAt < 24 * 60 * 60 * 1000;
}

/**
 * Latest rates for `base`: { base, rates, updatedAt, nextUpdateAt, fetchedAt, stale }.
 * Served from cache until the provider's next update; falls back to stale cache when offline.
 */
export async function getLatestRates(base, { signal, now = Date.now() } = {}) {
  if (!CODES.has(base)) throw new CurrencyError('UNSUPPORTED', `Unsupported currency: ${base}`);
  const cacheKey = RATES_CACHE_PREFIX + base;
  const cached = readJson(cacheKey);
  if (isFresh(cached, now)) return { ...cached, stale: false };

  try {
    const res = await fetch(LATEST_API + base, { signal });
    if (!res.ok) throw new CurrencyError('HTTP', `Rate service error (HTTP ${res.status}).`);
    const json = await res.json();
    if (json?.result !== 'success' || typeof json.rates !== 'object' || !json.rates) {
      throw new CurrencyError('BAD_RESPONSE', 'Rate service returned unexpected data.');
    }
    const rates = {};
    for (const code of CODES) {
      const value = Number(json.rates[code]);
      if (Number.isFinite(value) && value > 0) rates[code] = value;
    }
    const entry = {
      base,
      rates,
      updatedAt: Number(json.time_last_update_unix) * 1000 || now,
      // Re-check at the provider's next update, but not more than hourly.
      nextUpdateAt: Math.max(Number(json.time_next_update_unix) * 1000 || 0, now + MIN_REFRESH_MS),
      fetchedAt: now,
    };
    writeJson(cacheKey, entry);
    return { ...entry, stale: false };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    // Stale because the device is offline, or because the rate service failed (e.g. 503).
    const staleReason = err instanceof CurrencyError && (err.code === 'HTTP' || err.code === 'BAD_RESPONSE')
      ? 'error'
      : 'offline';
    if (cached) return { ...cached, stale: true, staleReason };
    if (err instanceof CurrencyError) throw err;
    throw new CurrencyError('NETWORK', 'Couldn’t load exchange rates. Check your connection.');
  }
}

/** Converts `amount` from → to. Returns { amount, from, to, rate, result, updatedAt, stale }. */
export async function convert(amount, from, to, options = {}) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) throw new CurrencyError('INVALID_AMOUNT', 'Enter a valid amount.');
  if (from === to) {
    return { amount: value, from, to, rate: 1, result: value, updatedAt: Date.now(), stale: false };
  }
  const data = await getLatestRates(from, options);
  const rate = data.rates[to];
  if (!rate) throw new CurrencyError('UNSUPPORTED', `No rate available for ${from} → ${to}.`);
  return { amount: value, from, to, rate, result: value * rate, updatedAt: data.updatedAt, stale: data.stale, staleReason: data.staleReason || null };
}

function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Daily rates for the last `days` days: [{ date, rate }] (oldest first), or null when
 * the pair isn't covered by the ECB data. Cached per pair for the day.
 */
export async function getRateHistory(from, to, { days = 7, signal, now = Date.now() } = {}) {
  if (from === to) return null;
  const today = isoDate(new Date(now));
  const cacheKey = `${HISTORY_CACHE_PREFIX}${from}-${to}-${days}`;
  const cached = readJson(cacheKey);
  if (cached?.day === today) return cached.points;

  const start = new Date(now);
  // Extra days so weekends/holidays (no ECB fixing) still leave ~`days` points.
  start.setDate(start.getDate() - Math.ceil(days * 1.6));
  const url = `${HISTORY_API}${isoDate(start)}..?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`;
  try {
    const res = await fetch(url, { signal });
    if (res.status === 404 || res.status === 422) {
      writeJson(cacheKey, { day: today, points: null });
      return null;
    }
    if (!res.ok) throw new CurrencyError('HTTP', `History service error (HTTP ${res.status}).`);
    const json = await res.json();
    const points = Object.entries(json?.rates || {})
      .map(([date, row]) => ({ date, rate: Number(row?.[to]) }))
      .filter((p) => Number.isFinite(p.rate) && p.rate > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-days);
    const result = points.length >= 2 ? points : null;
    writeJson(cacheKey, { day: today, points: result });
    return result;
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return cached?.points ?? null;
  }
}

// ---------------------------------------------------------------------------
// Formatting

export function formatMoney(value, code, { compact = false } = {}) {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const maximumFractionDigits = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      notation: compact && abs >= 100000 ? 'compact' : 'standard',
      maximumFractionDigits,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${code}`;
  }
}

export function formatRate(rate) {
  if (!Number.isFinite(rate)) return '—';
  const digits = rate >= 100 ? 2 : rate >= 1 ? 4 : 6;
  return rate.toLocaleString(undefined, { maximumFractionDigits: digits });
}

// ---------------------------------------------------------------------------
// Spotlight query parsing: "100 usd to inr", "$50 in rupees", "1.5k eur → gbp", "usd to inr"

// Whole-word connectors only, so "indian" or "into" never split a currency name.
const CONNECTOR_SPLIT = /\s+(?:into|to|in|as)\s+|\s*(?:=|->|→)\s*/;
const LEFT_SIDE = /^([$₹€£¥])?\s*(\d[\d.,]*(?:\s*(?:k|m|lakhs?|crores?)\b)?)?\s*(.*)$/i;

function parseAmount(text) {
  if (!text) return null;
  const match = /^(\d+(?:[.,]\d+)*(?:\.\d+)?)\s*(k|m|lakh|lakhs|crore|crores)?$/i.exec(text.trim());
  if (!match) return null;
  let value = Number(match[1].replace(/,/g, ''));
  const unit = (match[2] || '').toLowerCase();
  if (unit === 'k') value *= 1e3;
  if (unit === 'm') value *= 1e6;
  if (unit.startsWith('lakh')) value *= 1e5;
  if (unit.startsWith('crore')) value *= 1e7;
  return Number.isFinite(value) ? value : null;
}

/**
 * Parses a conversion request. Returns { amount, from, to } or null.
 * A missing amount means 1; a missing target uses the widget's saved "to" currency.
 */
// "<symbol?><amount?> <currency?>" → { amount (null if absent), from } or null.
function parseLeftSide(text) {
  const match = LEFT_SIDE.exec(text.trim());
  if (!match) return null;
  const [, symbol, amountText, rest] = match;
  const fromSymbol = symbol ? resolveCurrency(symbol) : null;
  const fromWords = rest ? resolveCurrency(rest) : null;
  if (rest && !fromWords) return null;
  if (fromSymbol && fromWords && fromSymbol !== fromWords) return null;
  const from = fromSymbol || fromWords;
  if (!from) return null;
  const amount = amountText ? parseAmount(amountText) : null;
  if (amountText && amount === null) return null;
  return { amount, from };
}

export function parseConversionQuery(input, { defaultTo = getCurrencyPrefs().to } = {}) {
  if (typeof input !== 'string') return null;
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text || text.length > 60) return null;

  const parts = text.split(CONNECTOR_SPLIT);
  if (parts.length > 2) return null;
  const left = parseLeftSide(parts[0]);
  if (!left) return null;

  if (parts.length === 2) {
    const to = resolveCurrency(parts[1]);
    return to ? { amount: left.amount ?? 1, from: left.from, to } : null;
  }

  // No target: needs an explicit amount ("100 eur", "$20"); uses the saved target currency.
  if (left.amount === null) return null;
  const to = left.from === defaultTo ? (left.from === 'USD' ? 'INR' : 'USD') : defaultTo;
  return { amount: left.amount, from: left.from, to };
}
