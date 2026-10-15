import { useEffect, useState } from 'react';
import {
  CHART_RANGES,
  GST_PCT,
  METAL_PREFS_EVENT,
  SOVEREIGN_GRAMS,
  formatChange,
  formatPrice,
  getChart,
  getMetalPrefs,
  getSessionState,
  isLiveSession,
  isMetal,
  metalPrice,
} from '../../libs/markets/marketService';
import PriceChart from './PriceChart';
import { startPolling } from './polling';
import {
  RANGE_PERIODS,
  RANGE_WORDS,
  changeBetween,
  directionOfPercent,
  errorMessage,
  formatMarketTime,
  formatPercent,
  formatSignedPercent,
  formatVolume,
  guessExchange,
  metalUnit,
  priceCurrency,
  speakChange,
} from './format';

// Right-hand pane of the Markets app: name, price and day change, market status, range
// tabs, the interactive chart, key statistics and (for gold/silver) the INR pricing notes.

const MINUTE = 60 * 1000;
const LIVE_RANGES = new Set(['1d', '5d']);
const METAL_PREFS_STORAGE_KEY = 'metalPrefs'; // marketService's storage key

const DIRECTION_WORDS = { up: 'Up', down: 'Down', flat: 'Unchanged' };

function RangeTabs({ value, onChange }) {
  // Radio group: arrow keys (and Home/End) move the selection, like macOS segmented controls.
  const handleKeyDown = (e) => {
    const count = CHART_RANGES.length;
    const index = CHART_RANGES.findIndex((range) => range.id === value);
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % count;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + count) % count;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = count - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(CHART_RANGES[next].id);
    e.currentTarget.querySelectorAll('[role="radio"]')[next]?.focus();
  };

  return (
    <div className="mk-ranges" role="radiogroup" aria-label="Chart range" onKeyDown={handleKeyDown}>
      {CHART_RANGES.map((range) => {
        const checked = range.id === value;
        return (
          <button
            key={range.id}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={`mk-range${checked ? ' is-active' : ''}`}
            title={RANGE_WORDS[range.id]}
            onClick={() => onChange(range.id)}
          >
            {range.label}
          </button>
        );
      })}
    </div>
  );
}

// Day price and change from whichever is newer: the quote (refreshed with the watchlist,
// stamped by its last intraday point) or the chart's metadata (stamped by marketTime).
function dayFigures(quote, meta) {
  const quoteTime = lastPointTime(quote?.points) ?? -Infinity;
  const metaTime = Number.isFinite(meta?.marketTime) ? meta.marketTime : -Infinity;
  const preferMeta = Number.isFinite(meta?.price) && (!Number.isFinite(quote?.price) || metaTime > quoteTime);
  const price = preferMeta ? meta.price : (quote?.price ?? null);
  const previousClose = (preferMeta ? meta?.previousClose : quote?.previousClose)
    ?? quote?.previousClose ?? meta?.previousClose ?? null;
  const day = changeBetween(previousClose, price);
  if (day.percent === null && Number.isFinite(price) && Number.isFinite(meta?.dayChangePercent)) {
    const percent = meta.dayChangePercent;
    return { price, change: price - price / (1 + percent / 100), percent, direction: directionOfPercent(percent) };
  }
  return { price, ...day };
}

function lastPointTime(points) {
  return Array.isArray(points) && points.length ? points[points.length - 1][0] : null;
}

// Both lines, whatever the card's Spot/Retail setting: the retail estimate (what shops are
// closer to) and the spot price it is derived from. Purity and duty follow the Gold card.
function metalEstimate(symbol, price, prefs) {
  if (!Number.isFinite(price)) return null;
  const rupees = (value) => formatPrice(value, { currency: 'INR', digits: 0 });
  const retail = { ...prefs, mode: 'retail' };
  const spot = { ...prefs, mode: 'spot' };
  const retailLabel = `Retail estimate (incl. ${prefs.dutyPct}% duty + ${GST_PCT}% GST)`;
  if (symbol === 'GOLD') {
    const describe = (opts) => `${rupees(metalPrice(price, { ...opts, grams: 1 }))} per gram (${prefs.purity}) · sovereign (${SOVEREIGN_GRAMS} g, 22K) ${rupees(metalPrice(price, { ...opts, grams: SOVEREIGN_GRAMS, purity: '22K' }))}`;
    return [`${retailLabel}: ${describe(retail)}`, `Spot (before duty and GST): ${describe(spot)}`];
  }
  const perKg = (opts) => rupees(metalPrice(price, { ...opts, grams: 1000, purity: '24K' }));
  return [`${retailLabel}: ${perKg(retail)} per kg`, `Spot (before duty and GST): ${perKg(spot)} per kg`];
}

export default function SymbolDetail({
  symbol,
  name,
  exchange,
  inWatchlist,
  onAdd,
  quote,
  quotesLoaded,
  now,
  visible,
  retryToken,
  headingRef,
  compact,
  onBack,
  chartHeight,
}) {
  const [range, setRange] = useState('1d');
  const [chartState, setChartState] = useState({ key: null, range: null, chart: null, error: null });
  const [chartRetry, setChartRetry] = useState(0);
  const [metalPrefs, setMetalPrefs] = useState(getMetalPrefs);

  // Gold/silver pricing preferences are shared with the Gold & Silver card.
  useEffect(() => {
    const refresh = () => setMetalPrefs(getMetalPrefs());
    const handleStorage = (e) => {
      if (e.key === null || e.key === METAL_PREFS_STORAGE_KEY) refresh();
    };
    window.addEventListener(METAL_PREFS_EVENT, refresh);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(METAL_PREFS_EVENT, refresh);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // Chart for the selected range. 1D/5D refresh every minute while that session is open;
  // nothing polls while the tab is hidden. Each change of symbol/range aborts the last request.
  const key = `${symbol}|${range}`;
  useEffect(() => {
    if (!visible) return undefined;
    return startPolling(async (signal) => {
      try {
        const chart = await getChart(symbol, range, { signal });
        if (signal.aborted) return null;
        setChartState({ key, range, chart, error: null });
        const live = LIVE_RANGES.has(range) && isLiveSession(chart.meta?.session, Date.now());
        return live ? MINUTE : null;
      } catch (err) {
        if (signal.aborted || err?.name === 'AbortError') return null;
        // A failed refresh keeps the chart already on screen.
        setChartState((prev) => (prev.key === key && prev.chart ? prev : { key, range, chart: null, error: errorMessage(err) }));
        return null;
      }
    });
  }, [symbol, range, key, visible, chartRetry, retryToken]);

  // While a new range loads, the previous chart of the same symbol stays up, dimmed.
  const settled = chartState.key === key;
  const sameSymbol = typeof chartState.key === 'string' && chartState.key.startsWith(`${symbol}|`);
  const chart = settled || sameSymbol ? chartState.chart : null;
  const shownRange = chart ? chartState.range : range;
  const refreshing = !settled && Boolean(chart);
  const chartLoading = !settled && !chart;
  const chartError = settled && !chart ? chartState.error : null;
  const meta = chart?.meta || null;

  const metal = isMetal(symbol);
  const currency = metal ? 'INR' : priceCurrency(symbol, meta?.currency ?? quote?.currency ?? null);
  const formatValue = (value) => formatPrice(value, { currency });
  const formatAxisValue = (value) => formatPrice(value, { currency: null });

  const displayName = name || meta?.name || quote?.name || symbol;
  const subtitle = [symbol, meta?.exchange || exchange || guessExchange(symbol)].filter(Boolean).join(' · ');

  const day = dayFigures(quote, meta);
  const sessionState = getSessionState(quote?.session ?? meta?.session, now);
  const marketTime = meta?.marketTime ?? lastPointTime(quote?.points);
  let statusText = 'Data delayed';
  if (sessionState === 'open') statusText = 'Market open · data delayed';
  else if (sessionState === 'closed') {
    statusText = Number.isFinite(marketTime)
      ? `At close · ${formatMarketTime(marketTime, meta?.timezone, now)}`
      : 'Market closed';
  }
  const stale = Boolean(quote?.stale || (settled && chart?.stale));

  // Chart reference: previous close on 1D, otherwise the close before the range began.
  const points = chart?.points || [];
  const firstValue = points.length ? points[0][1] : null;
  const lastValue = points.length ? points[points.length - 1][1] : null;
  const reference = shownRange === '1d'
    ? (meta?.previousClose ?? quote?.previousClose ?? null)
    : (meta?.rangeBaseline ?? firstValue);
  const move = changeBetween(reference, lastValue);
  const chartLabel = [
    displayName,
    RANGE_WORDS[shownRange],
    speakChange(move.percent),
    Number.isFinite(reference) && Number.isFinite(lastValue)
      ? `from ${formatValue(reference)} to ${formatValue(lastValue)}`
      : '',
  ].filter(Boolean).join(', ');

  const stats = meta
    ? [
      { label: 'Open', value: meta.open },
      { label: 'High', value: meta.dayHigh },
      { label: 'Low', value: meta.dayLow },
      { label: 'Prev close', value: shownRange === '1d' ? meta.previousClose : null },
      { label: '52W High', value: meta.fiftyTwoWeekHigh },
      { label: '52W Low', value: meta.fiftyTwoWeekLow },
      { label: 'Volume', value: meta.volume > 0 ? meta.volume : null, volume: true },
    ].filter((stat) => Number.isFinite(stat.value))
    : [];

  const estimate = metal ? metalEstimate(symbol, day.price, metalPrefs) : null;

  const addToList = () => {
    // The button disappears once added; keep focus in the pane.
    headingRef.current?.focus();
    onAdd({ symbol, name: displayName });
  };

  const arrow = day.direction === 'up' ? '▲' : day.direction === 'down' ? '▼' : '';

  return (
    <div className="mk-detail-inner">
      {compact && (
        <div className="mk-detail-nav">
          <button type="button" className="mk-back" onClick={onBack}>
            <svg viewBox="0 0 10 16" aria-hidden="true" focusable="false">
              <path d="M8 2 2 8l6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Watchlist
          </button>
        </div>
      )}

      <header className="mk-detail-head">
        <div className="mk-detail-titles">
          <h3 ref={headingRef} className="mk-detail-name" tabIndex={-1}>{displayName}</h3>
          <p className="mk-detail-sub">{subtitle}</p>
        </div>
        {!inWatchlist && (
          <button type="button" className="mk-btn mk-add" onClick={addToList}>
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M8 3.5v9M3.5 8h9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Add to Watchlist
          </button>
        )}
      </header>

      <div className="mk-quote">
        {Number.isFinite(day.price) ? (
          <p className="mk-price">
            <span className="mk-price-value">{formatValue(day.price)}</span>
            {metal && <span className="mk-price-unit">{metalUnit(symbol)}</span>}
          </p>
        ) : quotesLoaded || chartError ? (
          <p className="mk-price"><span className="mk-price-value">—</span></p>
        ) : (
          <span className="mk-skeleton mk-skeleton-price-lg" role="img" aria-label="Loading price" />
        )}
        {Number.isFinite(day.change) && Number.isFinite(day.percent) && (
          <p className={`mk-day-change mk-text-${day.direction}`}>
            {arrow && <span aria-hidden="true">{arrow} </span>}
            <span className="mk-sr-only">{DIRECTION_WORDS[day.direction]} </span>
            {`${formatChange(day.change)} (${formatPercent(day.percent)})`}
          </p>
        )}
        <p className="mk-status">
          <span className={`mk-status-dot mk-status-${sessionState}`} aria-hidden="true" />
          <span>{statusText}</span>
          {stale && <span className="mk-badge">Offline · showing last update</span>}
        </p>
      </div>

      <div className="mk-range-bar">
        <RangeTabs value={range} onChange={setRange} />
        {shownRange !== '1d' && Number.isFinite(move.percent) && !chartLoading && (
          <span className={`mk-range-change mk-text-${move.direction}`}>
            {`${formatSignedPercent(move.percent)} ${RANGE_PERIODS[shownRange]}`}
          </span>
        )}
      </div>

      <div className="mk-chart-box">
        {chartLoading && (
          <div className="mk-skeleton mk-chart-skeleton" style={{ height: chartHeight }} role="img" aria-label="Loading chart" />
        )}
        {chartError && (
          <div className="mk-chart-error" style={{ height: chartHeight }} role="alert">
            <p>{chartError}</p>
            <button type="button" className="mk-btn" onClick={() => setChartRetry((count) => count + 1)}>Retry</button>
          </div>
        )}
        {chart && (
          <PriceChart
            points={points}
            rangeId={shownRange}
            timeZone={meta?.timezone}
            reference={reference}
            showReference={shownRange === '1d' && Number.isFinite(reference)}
            session={meta?.session}
            direction={move.direction}
            label={chartLabel}
            formatValue={formatValue}
            formatAxisValue={formatAxisValue}
            height={chartHeight}
            refreshing={refreshing}
          />
        )}
      </div>

      {chartLoading ? (
        <div className="mk-stats mk-stats-loading" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="mk-stat"><span className="mk-skeleton mk-skeleton-stat" /></div>
          ))}
        </div>
      ) : stats.length > 0 && (
        <dl className={`mk-stats${refreshing ? ' is-refreshing' : ''}`}>
          {stats.map((stat) => (
            <div key={stat.label} className="mk-stat">
              <dt>{stat.label}</dt>
              <dd>{stat.volume ? formatVolume(stat.value) : formatValue(stat.value)}</dd>
            </div>
          ))}
        </dl>
      )}

      {metal && (
        <section className="mk-metal" aria-label={`${displayName} pricing notes`}>
          <p className="mk-metal-source">COMEX futures converted to INR per gram · indicative</p>
          {estimate && estimate.map((line) => <p key={line} className="mk-metal-estimate">{line}</p>)}
        </section>
      )}
    </div>
  );
}
