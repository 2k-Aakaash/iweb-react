import { useEffect, useState } from 'react';
import { searchSymbols } from '../../libs/markets/marketService';
import { errorMessage } from './format';

const DEBOUNCE_MS = 250;

/**
 * Debounced, abortable symbol search. Returns { query, status, results, error } where status
 * is 'idle' (empty query), 'loading' (previous results are kept meanwhile), 'ready' or 'error'.
 */
export function useSymbolSearch(rawQuery) {
  const query = rawQuery.trim();
  const [state, setState] = useState({ query: '', results: [], error: null });

  useEffect(() => {
    if (!query) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchSymbols(query, { signal: controller.signal })
        .then((results) => {
          if (!controller.signal.aborted) setState({ query, results, error: null });
        })
        .catch((err) => {
          if (controller.signal.aborted || err?.name === 'AbortError') return;
          setState({ query, results: [], error: errorMessage(err) });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  if (!query) return { query, status: 'idle', results: [], error: null };
  if (state.query !== query) return { query, status: 'loading', results: state.results, error: null };
  return { query, status: state.error ? 'error' : 'ready', results: state.results, error: state.error };
}
