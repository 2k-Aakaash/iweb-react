// Spotlight market answers: recognises questions about an index, a stock or gold/silver.
//
// parseMarketQuery(query) → null or one of
//   { kind: 'index', symbol }                          "nifty 50 today", "bank nifty", "vix"
//   { kind: 'metal', symbol: 'GOLD' | 'SILVER', purity?: '24K' | '22K' | '18K', sovereign?: true }
//                                                      "gold rate", "22k gold", "pavan rate", "silver price"
//   { kind: 'stock', query, loose? }                   "tcs share price", "infosys stock", "reliance price"
//   { kind: 'stock', symbol }                          "RELIANCE.NS", "tcs.bo"
//
// Currency conversions ("100 usd to inr") belong to the currency answer, so they return null.
// `loose` marks the one-word forms ("<name> price", "<name> share(s)", "<name> stock"), which are
// common outside markets ("petrol price", "screen share", "chicken stock"): their search result
// must visibly match the name (pickSearchResult), and Spotlight shows them only once found.

import { parseConversionQuery, resolveCurrency } from '../../libs/currency/currencyService';

const MAX_QUERY_LENGTH = 60;
const MAX_NAME_LENGTH = 40;

export const INDEX_NAMES = {
  '^NSEI': 'NIFTY 50',
  '^BSESN': 'SENSEX',
  '^NSEBANK': 'NIFTY BANK',
  '^CNXIT': 'NIFTY IT',
  '^INDIAVIX': 'INDIA VIX',
};

// A Map, so typed words like "constructor" never resolve to Object.prototype members.
const INDEX_ALIASES = new Map([
  ['nifty', '^NSEI'],
  ['nifty 50', '^NSEI'],
  ['nifty50', '^NSEI'],
  ['sensex', '^BSESN'],
  ['bse sensex', '^BSESN'],
  ['bank nifty', '^NSEBANK'],
  ['banknifty', '^NSEBANK'],
  ['nifty bank', '^NSEBANK'],
  ['nifty it', '^CNXIT'],
  ['india vix', '^INDIAVIX'],
  ['indiavix', '^INDIAVIX'],
  ['vix', '^INDIAVIX'],
]);

// Words that can surround an index or metal name without changing the question.
const TIME_WORDS = ['today', "today's", 'todays', 'live', 'now', 'current'];
const INDEX_FILLERS = new Set([...TIME_WORDS, 'index', 'price', 'level']);
const RATE_WORDS = new Set(['rate', 'rates', 'price', 'prices']);
const METAL_FILLERS = new Set([...TIME_WORDS, ...RATE_WORDS]);

const PURITY_RE = /\b(24|22|18)\s*(?:k|kt|ct|carat|carats|karat|karats)\b/;
const HALLMARK_916_RE = /\b916\b/; // BIS hallmark for 22K
const SOVEREIGN_RE = /\b(?:(1|one)\s+)?(?:sovereign|pavan|pavun)\b/;
const UNIT_RE = /\b(?:per|1|one)\s*(?:g|gm|gms|gram|grams|kg|kgs|kilo|kilogram|kilograms)\b/g;

const TICKER_RE = /^([a-z0-9][a-z0-9&_-]{0,19})\.(ns|bo)$/;
const STOCK_RE = /^(.+?)\s+(share price|stock price|shares|share|stock|price)(?:\s+(?:today|today's|todays|live|now))?$/;
const NAME_RE = /^[a-z0-9&.' -]+$/;

// A "name" that is really a question or a generic phrase ("what is share price", "penny stock").
const QUESTION_WORDS = new Set([
  'what', 'whats', "what's", 'how', 'why', 'when', 'where', 'which', 'who', 'is', 'are', 'should', 'will', 'does', 'do',
]);
const GENERIC_WORDS = new Set([
  ...TIME_WORDS, 'latest', 'a', 'an', 'the', 'my', 'this', 'that', 'all', 'any', 'in', 'out', 'of',
  'share', 'shares', 'stock', 'stocks', 'market', 'markets', 'price', 'prices', 'rate', 'rates',
  'best', 'top', 'good', 'cheap', 'penny', 'buy', 'sell', 'india', 'indian', 'nse', 'us',
]);

function normalize(input) {
  return input
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*[?!]+$/, '');
}

function parseIndex(text) {
  const name = text.split(' ').filter((word) => !INDEX_FILLERS.has(word)).join(' ');
  const symbol = INDEX_ALIASES.get(name);
  return symbol ? { kind: 'index', symbol } : null;
}

function parseMetal(text) {
  let rest = text;
  let purity = null;
  const carat = PURITY_RE.exec(rest);
  if (carat) {
    purity = `${carat[1]}K`;
    rest = rest.replace(carat[0], ' ');
  } else if (HALLMARK_916_RE.test(rest)) {
    purity = '22K';
    rest = rest.replace(HALLMARK_916_RE, ' ');
  }
  const sovereignMatch = SOVEREIGN_RE.exec(rest);
  if (sovereignMatch) rest = rest.replace(sovereignMatch[0], ' ');
  rest = rest.replace(UNIT_RE, ' ');

  let metal = null;
  let asksRate = false;
  for (const word of rest.split(' ')) {
    if (!word) continue;
    if (word === 'gold' || word === 'silver') {
      const symbol = word.toUpperCase();
      if (metal && metal !== symbol) return null;
      metal = symbol;
    } else if (METAL_FILLERS.has(word)) {
      if (RATE_WORDS.has(word)) asksRate = true;
    } else {
      return null;
    }
  }

  const sovereign = Boolean(sovereignMatch);
  if (!metal) {
    // "pavan rate", "1 sovereign", "22 carat rate" imply gold; a bare "pavan" (also a first
    // name) or "22k" does not.
    const impliesGold = sovereign ? asksRate || Boolean(sovereignMatch[1]) : Boolean(purity) && asksRate;
    if (!impliesGold) return null;
    metal = 'GOLD';
  }
  if (metal === 'SILVER' && (purity || sovereign)) return null;
  if (sovereign && purity && purity !== '22K') return null; // a sovereign is 22K

  const result = { kind: 'metal', symbol: metal };
  if (purity) result.purity = purity;
  if (sovereign) result.sovereign = true;
  return result;
}

function tickerSymbol(text) {
  const match = TICKER_RE.exec(text);
  return match ? `${match[1]}.${match[2]}`.toUpperCase() : null;
}

function parseStock(text) {
  const match = STOCK_RE.exec(text);
  if (!match) return null;
  const [, rawName, suffix] = match;
  const name = rawName.trim();

  const symbol = tickerSymbol(name);
  if (symbol) return { kind: 'stock', symbol };

  if (name.length < 2 || name.length > MAX_NAME_LENGTH || !NAME_RE.test(name) || !/[a-z0-9]/.test(name)) return null;
  const words = name.split(' ');
  if (QUESTION_WORDS.has(words[0]) || words.every((word) => GENERIC_WORDS.has(word))) return null;

  // "nifty share price" is about the index; "dollar price" is a currency, not a company.
  const index = parseIndex(name);
  if (index) return index;
  if (resolveCurrency(name)) return null;

  return suffix === 'share price' || suffix === 'stock price'
    ? { kind: 'stock', query: name }
    : { kind: 'stock', query: name, loose: true };
}

/** Parses a Spotlight query into a market request, or null when it isn't one (see top of file). */
export function parseMarketQuery(query) {
  if (typeof query !== 'string') return null;
  const text = normalize(query);
  if (!text || text.length > MAX_QUERY_LENGTH) return null;
  // The currency answer takes precedence: a conversion is never also a market answer.
  if (parseConversionQuery(query)) return null;

  const symbol = tickerSymbol(text);
  if (symbol) return { kind: 'stock', symbol };
  return parseIndex(text) || parseMetal(text) || parseStock(text);
}

// ---------------------------------------------------------------------------
// Choosing a search result for a stock name

const INDIAN_LISTING_RE = /\.(NS|BO)$/;
const compact = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
const spacedWords = (text) => ` ${text.toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim()}`;

// Whether a result is plausibly the company a loose query named: its ticker starts with the
// name ("sbi" → SBIN.NS, "l&t" → LT.NS) or a word of its name does ("airtel" → Bharti Airtel).
function matchesName(query, result) {
  const key = compact(query);
  if (!key) return false;
  if (compact(result.symbol.replace(INDIAN_LISTING_RE, '')).startsWith(key)) return true;
  // Whole words only: "petrol" must not match "Petroleum".
  return `${spacedWords(result.name || '')} `.includes(`${spacedWords(query)} `);
}

/**
 * The searchSymbols() result to quote for a stock name: the first NSE/BSE listing, else the
 * first result. Loose queries only consider results that match the name. null when none.
 */
export function pickSearchResult(results, { query = '', loose = false } = {}) {
  const candidates = (Array.isArray(results) ? results : []).filter(
    // Loose (one-word) phrases only quote a clearly named NSE/BSE listing.
    (item) => item && typeof item.symbol === 'string'
      && (!loose || (INDIAN_LISTING_RE.test(item.symbol) && matchesName(query, item))),
  );
  return candidates.find((item) => INDIAN_LISTING_RE.test(item.symbol)) || candidates[0] || null;
}
