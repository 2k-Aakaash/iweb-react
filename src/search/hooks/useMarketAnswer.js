import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  addToWatchlist,
  getMetalQuotes,
  getQuotes,
  getWatchlist,
  isMetal,
  openMarkets,
  searchSymbols,
  MarketError,
  METALS
} from '../../libs/markets/marketService';
import { INDEX_NAMES, parseMarketQuery, pickSearchResult } from '../utils/marketQuery';

const DEBOUNCE_MS = 150;
const FEEDBACK_MS = 1600;

function friendlyError(err) {
  if (err instanceof MarketError) {
    return err.code === 'NOT_FOUND' ? 'No market data for this symbol.' : err.message;
  }
  return 'Couldn’t load market data right now. Try again in a moment.';
}

/** Badge text: "INDEX", "NSE", "BSE", "GOLD", "SILVER", or the listing's exchange. */
function exchangeLabel(symbol, exchange) {
  if (isMetal(symbol)) return symbol;
  if (symbol.startsWith('^')) return 'INDEX';
  if (symbol.endsWith('.NS')) return 'NSE';
  if (symbol.endsWith('.BO')) return 'BSE';
  return exchange || 'Stock';
}

// What to fetch for a parsed query. Purity and sovereign only change the display, so
// "gold" → "22k gold" reuses the loaded quote.
function fetchSpec(request) {
  if (request.kind === 'metal') return { op: 'metal', symbol: request.symbol };
  if (request.symbol) return { op: 'quote', symbol: request.symbol };
  return { op: 'search', query: request.query, loose: Boolean(request.loose) };
}

/**
 * Loads the data for one fetchSpec: { quote, exchange }, or { notFound: true } when a stock
 * name matches nothing (Spotlight then shows no card). Exported for tests.
 */
export async function loadMarketAnswer({ op, symbol, query, loose }, { signal } = {}) {
  if (op === 'metal') {
    // getMetalQuotes falls back to the daily spot feed when live data is unavailable.
    const metals = await getMetalQuotes({ signal });
    return { quote: metals[symbol], exchange: symbol };
  }
  if (op === 'quote') {
    const quotes = await getQuotes([symbol], { signal });
    if (!quotes[symbol]) throw new MarketError('NOT_FOUND', 'No market data for this symbol.');
    return { quote: quotes[symbol], exchange: exchangeLabel(symbol) };
  }

  const match = pickSearchResult(await searchSymbols(query, { signal }), { query, loose });
  if (!match) return { notFound: true };
  if (isMetal(match.symbol)) return loadMarketAnswer({ op: 'metal', symbol: match.symbol }, { signal });
  try {
    const quotes = await getQuotes([match.symbol], { signal, names: { [match.symbol]: match.name } });
    if (!quotes[match.symbol]) return { notFound: true };
    return { quote: quotes[match.symbol], exchange: exchangeLabel(match.symbol, match.exchange) };
  } catch (err) {
    if (err?.code === 'NOT_FOUND') return { notFound: true };
    throw err;
  }
}

function defaultName(symbol) {
  return INDEX_NAMES[symbol] || METALS[symbol]?.name || symbol;
}

/**
 * Spotlight instant answer for market queries ("nifty", "22k gold rate", "tcs share price").
 * Returns null for anything else (including currency conversions), so other queries never render it.
 * status: 'loading' | 'ready' | 'error' | 'notFound'; `visible` says whether to show the card.
 */
export function useMarketAnswer(query) {
  const request = useMemo(() => parseMarketQuery(query), [query]);
  const key = request ? JSON.stringify(fetchSpec(request)) : null;

  // { key, data, error, receivedAt } for the last settled request.
  const [answer, setAnswer] = useState(null);
  // { key, kind: 'added' | 'exists' | 'failed' } shown briefly inside the card.
  const [feedback, setFeedback] = useState(null);
  const requestSeq = useRef(0);
  const feedbackTimer = useRef(null);

  useEffect(() => {
    if (!key) return undefined;

    const seq = ++requestSeq.current;
    const controller = new AbortController();

    const timer = setTimeout(() => {
      loadMarketAnswer(JSON.parse(key), { signal: controller.signal })
        .then((data) => {
          if (seq !== requestSeq.current) return;
          setAnswer({ key, data, error: null, receivedAt: Date.now() });
        })
        .catch((err) => {
          if (seq !== requestSeq.current || err?.name === 'AbortError') return;
          setAnswer({ key, data: null, error: friendlyError(err), receivedAt: Date.now() });
        });
    }, DEBOUNCE_MS);

    return () => {
      requestSeq.current += 1; // anything still in flight for this key is now stale
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  // Confirmation belongs to the answer it was shown for.
  useEffect(() => () => {
    clearTimeout(feedbackTimer.current);
    setFeedback(null);
  }, [key]);

  const flash = useCallback((kind) => {
    clearTimeout(feedbackTimer.current);
    setFeedback({ key, kind });
    feedbackTimer.current = setTimeout(() => setFeedback(null), FEEDBACK_MS);
  }, [key]);

  const current = answer && answer.key === key ? answer : null;
  const data = current?.data || null;
  const quote = data?.quote || null;
  // Indices, metals and tickers are known from the query; stock names once resolved.
  const symbol = quote?.symbol || request?.symbol || null;
  const name = quote?.name || (symbol ? defaultName(symbol) : null);

  const openInMarkets = useCallback(() => {
    if (!symbol) return false;
    openMarkets(symbol);
    return true;
  }, [symbol]);

  const addSymbolToWatchlist = useCallback(() => {
    if (!symbol) return;
    if (getWatchlist().some((item) => item.symbol === symbol)) {
      flash('exists');
      return;
    }
    const list = addToWatchlist({ symbol, name });
    flash(list.some((item) => item.symbol === symbol) ? 'added' : 'failed');
  }, [symbol, name, flash]);

  if (!request) return null;

  const status = !current ? 'loading' : current.error ? 'error' : data.notFound ? 'notFound' : 'ready';

  return {
    request,
    status,
    // Loose matches ("<name> price") appear only once a matching stock is loaded, so
    // everyday queries like "petrol price" never flash a card.
    visible: status !== 'notFound' && (!request.loose || status === 'ready'),
    quote,
    symbol,
    name,
    exchange: data?.exchange || (symbol ? exchangeLabel(symbol) : 'Stock'),
    error: current?.error || null,
    receivedAt: current?.receivedAt || null,
    feedback: feedback && feedback.key === key ? feedback.kind : null,
    openInMarkets,
    addToWatchlist: addSymbolToWatchlist
  };
}
