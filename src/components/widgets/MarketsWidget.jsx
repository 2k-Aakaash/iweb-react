import { useEffect, useState } from 'react';
import Sparkline from './shared/Sparkline';
import {
  MarketError,
  formatChangePercent,
  formatPrice,
  getQuotes,
  getSessionState,
  isLiveSession,
  openMarkets,
} from '../../libs/markets/marketService';
import { startPolling, useOnline, usePageVisible } from '../markets/polling';
import '../../styles/markets.css';

// Markets card for the Smart Stack: NIFTY 50 at a glance (value, day change, intraday
// sparkline against the previous close) with SENSEX underneath, coloured by NIFTY's day
// like the macOS Stocks widget. Clicking it opens the Markets app on NIFTY 50; it never
// expands in place, so it has no use for onExpandedChange.

const NIFTY = '^NSEI';
const SENSEX = '^BSESN';
const SYMBOLS = [NIFTY, SENSEX];
const OPEN_REFRESH_MS = 60 * 1000;
const CLOSED_REFRESH_MS = 15 * 60 * 1000;
const VALUE_MAX_SIZE = 30;
const VALUE_WIDTH = 126; // 150px card − 2 × 12px padding

const STATUS_TEXT = { open: 'Open', closed: 'Closed', offline: 'Offline', error: 'Not updated' };

// Shrinks long values so they never overflow the card (digits ≈ 0.6em, separators ≈ 0.32em).
function fitFontSize(text, max, available) {
  const ems = [...text].reduce((sum, char) => sum + (/[0-9\p{L}]/u.test(char) ? 0.6 : 0.32), 0);
  return Math.max(Math.round(max / 2), Math.min(max, Math.floor(available / Math.max(ems, 1))));
}

function describe(label, quote) {
  if (!quote || !Number.isFinite(quote.price)) return `${label} unavailable`;
  const percent = quote.changePercent;
  let change = '';
  if (Number.isFinite(percent)) {
    change = Math.abs(percent) < 0.005 ? ', unchanged' : `, ${percent > 0 ? 'up' : 'down'} ${Math.abs(percent).toFixed(2)}%`;
  }
  return `${label} ${formatPrice(quote.price, { currency: null })}${change}`;
}

// Warms the Markets app's lazy chunk on hover/focus so it opens instantly.
const preloadMarketsApp = () => {
  import('../markets/MarketsModal').catch(() => {});
};

export default function MarketsWidget({ active = true }) {
  const [data, setData] = useState({ quotes: null, error: null });
  const [retryCount, setRetryCount] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const visible = usePageVisible();
  const online = useOnline();

  // Loads on mount and whenever the card is shown (cached quotes make that cheap), then
  // refreshes only while it is the visible card in a visible tab: every minute while NSE
  // is open, every 15 minutes otherwise. Changing state aborts the request in flight.
  useEffect(() => {
    if (!visible) return undefined;
    return startPolling(async (signal) => {
      try {
        const quotes = await getQuotes(SYMBOLS, { signal });
        if (signal.aborted) return null;
        const time = Date.now();
        setData({ quotes, error: null });
        setNow(time);
        if (!active) return null;
        const lead = quotes[NIFTY] || quotes[SENSEX];
        return isLiveSession(lead?.session, time) ? OPEN_REFRESH_MS : CLOSED_REFRESH_MS;
      } catch (err) {
        if (signal.aborted || err?.name === 'AbortError') return null;
        const message = err instanceof MarketError ? err.message : 'Couldn’t load market data.';
        setData((prev) => ({ ...prev, error: message }));
        return active && err?.code !== 'NOT_CONFIGURED' ? OPEN_REFRESH_MS : null;
      }
    });
  }, [active, visible, retryCount]);

  // Retry as soon as the connection comes back.
  useEffect(() => {
    const handleOnline = () => setRetryCount((count) => count + 1);
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  const nifty = data.quotes?.[NIFTY] || null;
  const sensex = data.quotes?.[SENSEX] || null;
  const ready = Boolean(nifty || sensex);
  const failure = ready ? null : data.error;
  const loading = !ready && !failure;

  const stale = Boolean(nifty?.stale || sensex?.stale);
  const session = getSessionState((nifty || sensex)?.session, now);
  // Offline whenever the browser is (even if the cached quotes are still fresh); a stale
  // quote while online means the data source failed.
  let status = session;
  if (!online || (stale && (nifty || sensex)?.staleReason === 'offline')) status = 'offline';
  else if (stale) status = 'error';
  const statusText = STATUS_TEXT[status] || '';
  const mood = nifty?.direction || 'flat';

  const valueText = Number.isFinite(nifty?.price) ? formatPrice(nifty.price, { currency: null }) : '—';
  const valueSize = fitFontSize(valueText, VALUE_MAX_SIZE, VALUE_WIDTH);
  const values = nifty?.points?.length > 1 ? nifty.points.map((point) => point[1]) : null;
  const baseline = Number.isFinite(nifty?.previousClose) ? nifty.previousClose : null;
  const sensexText = Number.isFinite(sensex?.price) ? formatPrice(sensex.price, { currency: null, digits: 0 }) : '—';

  let label = 'Markets';
  if (loading) label += ', loading';
  if (ready) {
    label += `. ${describe('NIFTY 50', nifty)}. ${describe('SENSEX', sensex)}.`;
    if (status === 'offline') label += ' Offline, showing the last update.';
    else if (status === 'error') label += ' Couldn’t refresh, showing the last update.';
    else if (status === 'open') label += ' Market open.';
    else if (status === 'closed') label += ' Market closed.';
  }

  return (
    <div className={`cw-card mw-card cw-mood-${mood}`}>
      <button
        type="button"
        className="mw-open"
        aria-label={label}
        title="Open Markets"
        onClick={() => openMarkets(NIFTY)}
        onPointerEnter={preloadMarketsApp}
        onFocus={preloadMarketsApp}
      />

      <div className="mw-head" aria-hidden="true">
        <span className="mw-title">NIFTY 50</span>
        {ready && statusText && (
          <span className={`mw-status mw-status-${status}`}>
            <span className="mw-status-dot" />
            {statusText}
          </span>
        )}
      </div>

      {loading && (
        <div className="mw-body" aria-hidden="true">
          <span className="cw-shimmer mw-shimmer-value" />
          <span className="cw-shimmer mw-shimmer-spark" />
          <span className="cw-shimmer cw-shimmer-line" />
        </div>
      )}

      {failure && (
        <div className="cw-error mw-error" role="alert">
          <span>{failure}</span>
          <button type="button" className="cw-retry" onClick={() => setRetryCount((count) => count + 1)}>
            Try again
          </button>
        </div>
      )}

      {ready && (
        <div className="mw-body" aria-hidden="true">
          <span className="cw-value mw-value" style={{ fontSize: valueSize }}>{valueText}</span>
          <span className={`cw-change cw-change-${mood} mw-change`}>{formatChangePercent(nifty?.changePercent)}</span>
          <span className="mw-spark">
            {values && <Sparkline values={values} baseline={baseline} width={126} height={24} className="mw-spark-svg" />}
          </span>
          <span className="mw-sub">
            <span className="mw-sub-name">SENSEX</span>
            <span className="mw-sub-value">{sensexText}</span>
            <span className="mw-sub-change">{formatChangePercent(sensex?.changePercent)}</span>
          </span>
        </div>
      )}
    </div>
  );
}
