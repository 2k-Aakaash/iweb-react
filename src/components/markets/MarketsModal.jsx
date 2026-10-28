import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  DEFAULT_WATCHLIST,
  WATCHLIST_EVENT,
  addToWatchlist,
  getQuotes,
  getWatchlist,
  isLiveSession,
  removeFromWatchlist,
  setWatchlist,
} from '../../libs/markets/marketService';
import SymbolDetail from './SymbolDetail';
import { SearchField, SearchResults } from './SymbolSearch';
import Watchlist from './Watchlist';
import { errorMessage } from './format';
import { moveItem } from './listOrder';
import { startPolling, usePageVisible } from './polling';
import { useSymbolSearch } from './useSymbolSearch';
import GlassSurface from '../glass/GlassSurface';
import '../../styles/markets.css';

// The Markets app: a macOS Stocks-style window with the watchlist (and symbol search) in
// the sidebar and the selected symbol's chart and statistics on the right. Lazy-loaded by
// App.jsx when something dispatches `markets:open` (the Markets card, Spotlight).
//
// Polling: watchlist quotes refresh every minute while any session is open (else every
// 15 minutes) and the 1D/5D chart every minute while its session is open; everything stops
// while the tab is hidden and is aborted on close.

const MINUTE = 60 * 1000;
const OPEN_REFRESH_MS = MINUTE;
const CLOSED_REFRESH_MS = 15 * MINUTE;
const NARROW_QUERY = '(max-width: 720px)';
const CLOSE_ANIMATION_MS = 180;
const CHANGE_MODE_KEY = 'marketsChangeMode';
const WATCHLIST_STORAGE_KEY = 'marketsWatchlist'; // marketService's storage key
const WATCHLIST_LIMIT = 50; // setWatchlist keeps the first 50
const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

const dateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long' });

function readChangeMode() {
  try {
    return localStorage.getItem(CHANGE_MODE_KEY) === 'absolute' ? 'absolute' : 'percent';
  } catch {
    return 'percent';
  }
}

function writeChangeMode(mode) {
  try {
    localStorage.setItem(CHANGE_MODE_KEY, mode);
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
}

function useMediaQuery(query) {
  const subscribe = useCallback((callback) => {
    const list = window.matchMedia(query);
    list.addEventListener('change', callback);
    return () => list.removeEventListener('change', callback);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function isTypingTarget(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function tabbables(root) {
  return [...root.querySelectorAll(TABBABLE)].filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
}

function findRowMain(list, symbol) {
  if (!list || !symbol) return null;
  const row = [...list.querySelectorAll('[data-symbol]')].find((element) => element.dataset.symbol === symbol);
  return row?.querySelector('.mk-row-main') || null;
}

export default function MarketsModal({ initialSymbol = null, onClose }) {
  const [initial] = useState(() => {
    const list = getWatchlist();
    return { list, symbol: initialSymbol || list[0]?.symbol || null };
  });
  const [watchlist, setWatchlistState] = useState(initial.list);
  const [selected, setSelected] = useState(initial.symbol);
  const [requested, setRequested] = useState(initialSymbol);
  const [lookup, setLookup] = useState({});
  const [quoteState, setQuoteState] = useState({ quotes: {}, error: null, loaded: false });
  const [retryToken, setRetryToken] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [changeMode, setChangeMode] = useState(readChangeMode);
  const [query, setQuery] = useState('');
  const [view, setView] = useState(initialSymbol ? 'detail' : 'list');
  const [closing, setClosing] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingSubmit, setPendingSubmit] = useState(null);

  const narrow = useMediaQuery(NARROW_QUERY);
  const visible = usePageVisible();
  const search = useSymbolSearch(query);

  const windowRef = useRef(null);
  const searchRef = useRef(null);
  const resultsRef = useRef(null);
  const listRef = useRef(null);
  const headingRef = useRef(null);
  const namesRef = useRef({});
  const pendingFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);

  const titleId = useId();
  const resultsId = useId();

  // Another open request while the app is open (e.g. from Spotlight) shows that symbol.
  if (initialSymbol !== requested) {
    setRequested(initialSymbol);
    if (initialSymbol) {
      setSelected(initialSymbol);
      setView('detail');
    }
  }

  const effectiveView = selected ? view : 'list';
  const searching = query.trim().length > 0;

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // ---- Watchlist sync (other components, Spotlight and other tabs) -------------------

  useEffect(() => {
    const sync = (e) => setWatchlistState(Array.isArray(e.detail) ? e.detail : getWatchlist());
    const handleStorage = (e) => {
      if (e.key === null || e.key === WATCHLIST_STORAGE_KEY) setWatchlistState(getWatchlist());
    };
    window.addEventListener(WATCHLIST_EVENT, sync);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(WATCHLIST_EVENT, sync);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // ---- Quotes: one batched request for every row (plus a searched symbol) -------------

  // Names label the quotes; read through a ref so renaming never refetches.
  useEffect(() => {
    const names = {};
    for (const [symbol, info] of Object.entries(lookup)) names[symbol] = info.name;
    for (const item of watchlist) names[item.symbol] = item.name;
    namesRef.current = names;
  }, [watchlist, lookup]);

  // Sorted, so reordering the watchlist doesn't refetch.
  const symbolsKey = useMemo(() => {
    const symbols = new Set(watchlist.map((item) => item.symbol));
    if (selected) symbols.add(selected);
    return [...symbols].sort().join('|');
  }, [watchlist, selected]);

  useEffect(() => {
    if (!visible || !symbolsKey) return undefined;
    const symbols = symbolsKey.split('|');
    return startPolling(async (signal) => {
      try {
        const quotes = await getQuotes(symbols, { signal, names: namesRef.current });
        if (signal.aborted) return null;
        const time = Date.now();
        setQuoteState({ quotes, error: null, loaded: true });
        setNow(time);
        const anyOpen = Object.values(quotes).some((quote) => isLiveSession(quote.session, time));
        return anyOpen ? OPEN_REFRESH_MS : CLOSED_REFRESH_MS;
      } catch (err) {
        if (signal.aborted || err?.name === 'AbortError') return null;
        setQuoteState((prev) => ({ ...prev, error: errorMessage(err), loaded: true }));
        setNow(Date.now());
        return err?.code === 'NOT_CONFIGURED' ? null : OPEN_REFRESH_MS;
      }
    });
  }, [symbolsKey, visible, retryToken]);

  // Back online: refresh quotes and the chart straight away.
  useEffect(() => {
    const handleOnline = () => setRetryToken((count) => count + 1);
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  // ---- Focus ------------------------------------------------------------------------

  const applyFocus = useEffectEvent((request) => {
    const win = windowRef.current;
    if (!win) return;
    let target;
    if (request.type === 'search') target = searchRef.current;
    else if (request.type === 'detail') target = headingRef.current;
    else if (request.type === 'row') target = findRowMain(listRef.current, request.symbol);
    else if (narrow && effectiveView === 'detail') target = headingRef.current;
    else target = findRowMain(listRef.current, selected) || findRowMain(listRef.current, watchlist[0]?.symbol) || searchRef.current;
    (target && target.getClientRects().length ? target : win).focus({ preventScroll: true });
  });

  // Keep focus inside the window (registered first so it is removed before focus returns).
  useEffect(() => {
    const handleFocusIn = (e) => {
      const win = windowRef.current;
      if (win && !win.contains(e.target)) (tabbables(win)[0] || win).focus({ preventScroll: true });
    };
    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, []);

  // Initial focus, and back to whatever opened the app (e.g. the Markets card) on close.
  useEffect(() => {
    const returnTo = document.activeElement;
    applyFocus({ type: 'initial' });
    return () => {
      if (!(returnTo instanceof HTMLElement) || returnTo === document.body || !returnTo.isConnected) return;
      // The opener may have been hidden meanwhile (e.g. "Open in Markets" inside a Smart Stack
      // card that collapsed while the app was open): fall back to that card's header, then
      // to the nearest focusable container.
      const isShown = (element) => element && element.getClientRects().length > 0;
      const target = [
        returnTo,
        returnTo.closest('.cw-card')?.querySelector('.cw-header, .mw-open'),
        returnTo.closest('[tabindex="0"]'),
      ].find(isShown);
      target?.focus({ preventScroll: true });
    };
  }, []);

  // Focus requested by an action, applied once the resulting render is on screen.
  useEffect(() => {
    const request = pendingFocusRef.current;
    if (!request) return;
    pendingFocusRef.current = null;
    applyFocus(request);
  });

  // ---- Closing ----------------------------------------------------------------------

  const requestClose = useCallback(() => {
    if (prefersReducedMotion()) {
      onCloseRef.current?.();
      return;
    }
    setClosing(true);
  }, []);

  useEffect(() => {
    if (!closing) return undefined;
    const timer = setTimeout(() => onCloseRef.current?.(), CLOSE_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [closing]);

  // ---- Actions ----------------------------------------------------------------------

  const selectSymbol = useCallback((symbol) => setSelected(symbol), []);

  const openSymbol = useCallback((symbol) => {
    setSelected(symbol);
    setView('detail');
    if (narrow) pendingFocusRef.current = { type: 'detail' };
  }, [narrow]);

  const openResult = useCallback((result) => {
    setLookup((prev) => (prev[result.symbol] ? prev : { ...prev, [result.symbol]: { name: result.name, exchange: result.exchange } }));
    openSymbol(result.symbol);
  }, [openSymbol]);

  const addSymbol = useCallback((item) => {
    const list = getWatchlist();
    if (list.some((entry) => entry.symbol === item.symbol)) return;
    if (list.length >= WATCHLIST_LIMIT) {
      const message = `Your watchlist is full (${WATCHLIST_LIMIT} symbols). Remove one to add another.`;
      setNotice(message);
      setAnnouncement(message);
      return;
    }
    addToWatchlist({ symbol: item.symbol, name: item.name });
    setNotice('');
    setAnnouncement(`Added ${item.name} to your watchlist.`);
  }, []);

  const removeSymbol = useCallback((symbol) => {
    const list = getWatchlist();
    const index = list.findIndex((item) => item.symbol === symbol);
    if (index === -1) return;
    const removed = list[index];
    const neighbour = list[index + 1] || list[index - 1] || null;
    removeFromWatchlist(symbol);
    setSelected((current) => (current === symbol ? neighbour?.symbol ?? null : current));
    setNotice('');
    setAnnouncement(`Removed ${removed.name} from your watchlist.`);
    pendingFocusRef.current = neighbour ? { type: 'row', symbol: neighbour.symbol } : { type: 'search' };
  }, []);

  const moveSymbol = useCallback((symbol, toIndex) => {
    const list = getWatchlist();
    const from = list.findIndex((item) => item.symbol === symbol);
    const to = Math.max(0, Math.min(list.length - 1, toIndex));
    if (from === -1 || to === from) return;
    setWatchlist(moveItem(list, from, to));
    setAnnouncement(`${list[from].name} moved to position ${to + 1} of ${list.length}.`);
    // Moving a focused node in the DOM can blur it; put focus back on the moved row.
    pendingFocusRef.current = { type: 'row', symbol };
  }, []);

  const restoreDefaults = useCallback(() => {
    const list = setWatchlist(DEFAULT_WATCHLIST);
    setSelected((current) => current ?? list[0]?.symbol ?? null);
    pendingFocusRef.current = { type: 'row', symbol: list[0]?.symbol };
  }, []);

  const toggleChangeMode = useCallback(() => {
    const next = changeMode === 'percent' ? 'absolute' : 'percent';
    setChangeMode(next);
    writeChangeMode(next);
  }, [changeMode]);

  const retryQuotes = useCallback(() => setRetryToken((count) => count + 1), []);

  const showList = () => {
    setView('list');
    pendingFocusRef.current = { type: 'row', symbol: selected };
  };

  const focusSearch = () => {
    if (narrow && effectiveView === 'detail') {
      setView('list');
      pendingFocusRef.current = { type: 'search' };
      return;
    }
    searchRef.current?.focus();
    searchRef.current?.select();
  };

  const submitSearch = () => {
    if (search.status === 'ready') {
      const first = search.results[0];
      if (first) openResult(first);
    } else if (search.status === 'loading') {
      // Results on screen still belong to the previous query: open this query's first
      // result as soon as it arrives instead.
      setPendingSubmit(search.query);
    }
  };

  const completePendingSubmit = useEffectEvent(() => {
    const target = pendingSubmit;
    setPendingSubmit(null);
    if (search.query === target && search.status === 'ready' && search.results[0]) openResult(search.results[0]);
  });

  useEffect(() => {
    if (!pendingSubmit || (search.query === pendingSubmit && search.status === 'loading')) return;
    completePendingSubmit();
  }, [pendingSubmit, search.query, search.status]);

  const focusFirstResult = () => {
    resultsRef.current?.querySelector('.mk-result-open')?.focus();
  };

  // ---- Keyboard ---------------------------------------------------------------------

  const trapTab = (e) => {
    const win = windowRef.current;
    const items = tabbables(win);
    if (!items.length) {
      e.preventDefault();
      win.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === win || !win.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !win.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      // Esc clears a search first, then closes.
      if (query) {
        setQuery('');
        searchRef.current?.focus();
      } else {
        requestClose();
      }
      return;
    }
    if (e.key === 'Tab') {
      trapTab(e);
      return;
    }
    if (e.altKey) return;
    // Ctrl/Cmd+K would open Spotlight underneath this modal (and fight its focus trap), so
    // inside the Markets app it searches symbols instead, like Ctrl/Cmd+F and "/".
    const findKey = (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'k');
    const slashKey = e.key === '/' && !e.ctrlKey && !e.metaKey && !isTypingTarget(e.target);
    if (findKey || slashKey) {
      e.preventDefault();
      e.stopPropagation();
      focusSearch();
    }
  };

  const handleOverlayPointerDown = (e) => {
    if (e.target === e.currentTarget) requestClose();
  };

  // ---- Render -----------------------------------------------------------------------

  const watchSymbols = useMemo(() => new Set(watchlist.map((item) => item.symbol)), [watchlist]);
  const selectedItem = watchlist.find((item) => item.symbol === selected) || null;
  const anyStale = Object.values(quoteState.quotes).some((quote) => quote.stale);

  return (
    <div className={`mk-overlay${closing ? ' is-closing' : ''}`} onPointerDown={handleOverlayPointerDown}>
      <div
        ref={windowRef}
        className="mk-window glass-host"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-view={effectiveView}
        onKeyDown={handleKeyDown}
      >
        <GlassSurface preset="window" />
        <div className="mk-window-controls">
          <button type="button" className="mk-light mk-light-close" aria-label="Close Markets" title="Close" onClick={requestClose}>
            <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <path d="m3.5 3.5 5 5m0-5-5 5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
          <span className="mk-light mk-light-minimize" aria-hidden="true" />
          <span className="mk-light mk-light-zoom" aria-hidden="true" />
        </div>

        <aside className="mk-sidebar" aria-label="Watchlist and search">
          <header className="mk-sidebar-head">
            <h2 id={titleId} className="mk-title">Markets</h2>
            <p className="mk-date">{dateFormat.format(now)}</p>
          </header>

          <SearchField
            value={query}
            onChange={setQuery}
            inputRef={searchRef}
            resultsId={resultsId}
            onSubmit={submitSearch}
            onArrowDown={focusFirstResult}
          />

          {anyStale && !searching && <p className="mk-offline-note">Offline · showing last update</p>}
          {notice && <p className="mk-notice" role="status">{notice}</p>}

          <div className="mk-sidebar-scroll">
            {searching ? (
              <SearchResults
                id={resultsId}
                containerRef={resultsRef}
                search={search}
                watchSymbols={watchSymbols}
                onOpen={openResult}
                onAdd={addSymbol}
                onExitToInput={() => searchRef.current?.focus()}
              />
            ) : (
              <Watchlist
                items={watchlist}
                quotes={quoteState.quotes}
                loaded={quoteState.loaded}
                error={quoteState.error}
                onRetry={retryQuotes}
                selected={selected}
                changeMode={changeMode}
                listRef={listRef}
                onSelect={selectSymbol}
                onOpen={openSymbol}
                onRemove={removeSymbol}
                onMove={moveSymbol}
                onToggleChangeMode={toggleChangeMode}
                onRestoreDefaults={restoreDefaults}
              />
            )}
          </div>
        </aside>

        <section className="mk-detail" aria-label="Symbol details">
          {selected ? (
            <SymbolDetail
              symbol={selected}
              name={selectedItem?.name || lookup[selected]?.name || null}
              exchange={lookup[selected]?.exchange || null}
              inWatchlist={Boolean(selectedItem)}
              onAdd={addSymbol}
              quote={quoteState.quotes[selected] || null}
              quotesLoaded={quoteState.loaded}
              now={now}
              visible={visible}
              retryToken={retryToken}
              headingRef={headingRef}
              compact={narrow}
              onBack={showList}
              chartHeight={narrow ? 220 : 260}
            />
          ) : (
            <div className="mk-detail-empty">
              <p className="mk-empty-title">No symbol selected</p>
              <p>Search NSE / BSE or add a symbol to your watchlist to see its chart.</p>
            </div>
          )}
        </section>

        <footer className="mk-footer">Data from Yahoo Finance, delayed · Not investment advice</footer>
        <p className="mk-sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
      </div>
    </div>
  );
}
