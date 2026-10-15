import { useEffect, useId, useRef, useState } from 'react';
import Sparkline from './shared/Sparkline';
import { useCardExpand } from './shared/useCardExpand';
import {
  ATTRIBUTION,
  CURRENCIES,
  CurrencyError,
  convert,
  formatMoney,
  formatRate,
  getCurrency,
  getCurrencyPrefs,
  getCurrencySymbol,
  PREFS_EVENT,
  getRateHistory,
  setCurrencyPrefs,
} from '../../libs/currency/currencyService';

// Currency converter card for the Smart Stack. Sized, styled and animated like the
// Weather card: a glanceable 150×150 tile that expands (shared useCardExpand, same GSAP
// timeline values as Weather) into the full converter.

const HISTORY_DAYS = 7;
const TICK_MS = 30 * 1000;

const numberParts = new Intl.NumberFormat().formatToParts(12345.6);
const GROUP_SEPARATOR = numberParts.find((part) => part.type === 'group')?.value ?? ',';
const DECIMAL_SEPARATOR = numberParts.find((part) => part.type === 'decimal')?.value ?? '.';
const amountFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });
const percentFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const clockFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

// Parses the amount field in the user's locale ("1,234.5", "1.234,5", "1 234,5").
function parseAmount(text) {
  const normalized = text
    .replace(/\s/g, '')
    .split(GROUP_SEPARATOR)
    .join('')
    .replace(DECIMAL_SEPARATOR, '.');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) && value < 1e15 ? value : null;
}

function formatRelative(timestamp, now) {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return relativeFormat.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return relativeFormat.format(-hours, 'hour');
  return relativeFormat.format(-Math.round(hours / 24), 'day');
}

function formatClock(timestamp, now) {
  const date = new Date(timestamp);
  const sameDay = date.toDateString() === new Date(now).toDateString();
  return sameDay ? clockFormat.format(date) : `${dayFormat.format(date)}, ${clockFormat.format(date)}`;
}

function formatDay(isoDate) {
  return dayFormat.format(new Date(`${isoDate}T00:00:00`));
}

// Shrinks long values so they never overflow the card (≈0.6em per glyph).
function fitFontSize(text, max, available) {
  const estimate = Math.floor(available / (Math.max(text.length, 1) * 0.6));
  return Math.max(Math.round(max / 2), Math.min(max, estimate));
}

function describeTrend(points) {
  if (!points) return null;
  const first = points[0].rate;
  const last = points[points.length - 1].rate;
  const rates = points.map((point) => point.rate);
  const change = ((last - first) / first) * 100;
  const flat = Math.abs(change) < 0.005;
  const direction = flat ? 'flat' : change > 0 ? 'up' : 'down';
  const value = `${percentFormat.format(Math.abs(change))}%`;
  return {
    min: Math.min(...rates),
    max: Math.max(...rates),
    direction,
    text: flat ? value : `${change > 0 ? '▲' : '▼'} ${value}`,
    label: flat ? `Unchanged over ${HISTORY_DAYS} days` : `${change > 0 ? 'Up' : 'Down'} ${value} over ${HISTORY_DAYS} days`,
  };
}

function CurrencyPicker({ label, value, onChange }) {
  const currency = getCurrency(value);
  return (
    <div className="cw-picker">
      <span className="cw-flag" aria-hidden="true">{currency ? getCurrencySymbol(currency.code) : ''}</span>
      <span className="cw-picker-code" aria-hidden="true">{value}</span>
      <span className="cw-picker-name" aria-hidden="true">{currency?.name}</span>
      <svg className="cw-picker-chevron" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
        <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} data-stack-no-flip>
        {CURRENCIES.map((option) => (
          <option key={option.code} value={option.code}>
            {`${option.code} — ${option.name}`}
          </option>
        ))}
      </select>
    </div>
  );
}

const stopPropagation = (e) => e.stopPropagation();

export default function CurrencyWidget({ active = true, onExpandedChange }) {
  const [initialPrefs] = useState(getCurrencyPrefs);
  const [amount, setAmount] = useState(initialPrefs.amount);
  const [amountText, setAmountText] = useState(() => amountFormat.format(initialPrefs.amount));
  const [amountInvalid, setAmountInvalid] = useState(false);
  const [from, setFrom] = useState(initialPrefs.from);
  const [to, setTo] = useState(initialPrefs.to);
  const [conversion, setConversion] = useState(null);
  const [failure, setFailure] = useState(null);
  const [history, setHistory] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [isExpanded, setIsExpanded] = useState(false);

  // Follow pair changes made elsewhere (Spotlight "Use in widget", other tabs).
  useEffect(() => {
    const apply = (prefs) => {
      setAmount(prefs.amount);
      // Our own save echoes back synchronously: keep in-progress text such as "1." (which
      // parses to the same amount) instead of reformatting it to "1" mid-typing.
      setAmountText((text) => (parseAmount(text) === prefs.amount ? text : amountFormat.format(prefs.amount)));
      setAmountInvalid(false);
      setFrom(prefs.from);
      setTo(prefs.to);
    };
    const onPrefs = (e) => apply(e.detail || getCurrencyPrefs());
    const onStorage = (e) => {
      if (e.key === 'currencyWidget') apply(getCurrencyPrefs());
    };
    window.addEventListener(PREFS_EVENT, onPrefs);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(PREFS_EVENT, onPrefs);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  const [swapTurns, setSwapTurns] = useState(0);

  const cardRef = useRef(null);
  const headerRef = useRef(null);
  const controlsRef = useRef(null);
  const dividerRef = useRef(null);
  const detailsRef = useRef(null);

  const controlsId = useId();
  const amountId = useId();

  const requestKey = `${amount}|${from}|${to}`;
  const pairKey = `${from}-${to}`;

  useEffect(() => {
    onExpandedChange?.(isExpanded);
  }, [isExpanded, onExpandedChange]);

  // Conversion. Rates are cached by the service, so this is instant except on a cold or
  // expired cache. Re-runs when the card is shown to pick up a newer daily rate.
  useEffect(() => {
    const controller = new AbortController();
    convert(amount, from, to, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setConversion(result);
        setFailure(null);
        setNow(Date.now());
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'AbortError') return;
        const message = err instanceof CurrencyError ? err.message : 'Couldn’t convert right now. Please try again.';
        setFailure({ key: requestKey, message });
      });
    return () => controller.abort();
  }, [amount, from, to, requestKey, active, retryCount]);

  // 7-day trend (ECB pairs only; null when the pair isn't covered).
  useEffect(() => {
    const controller = new AbortController();
    getRateHistory(from, to, { days: HISTORY_DAYS, signal: controller.signal })
      .then((points) => {
        if (!controller.signal.aborted) setHistory({ pair: pairKey, points });
      })
      .catch(() => {
        if (!controller.signal.aborted) setHistory({ pair: pairKey, points: null });
      });
    return () => controller.abort();
  }, [from, to, pairKey, active]);

  // Keeps "Updated … ago" current while the card is visible.
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);

  // Retry as soon as the connection comes back.
  useEffect(() => {
    const handleOnline = () => setRetryCount((count) => count + 1);
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  useCardExpand({
    isExpanded,
    onCollapse: () => setIsExpanded(false),
    cardRef,
    panelRefs: [controlsRef, detailsRef],
    dividerRef,
  });

  const toggleExpand = () => setIsExpanded((value) => !value);

  const handleCardKeyDown = (e) => {
    if (e.key !== 'Escape' || !isExpanded) return;
    e.stopPropagation();
    setIsExpanded(false);
    headerRef.current?.focus();
  };

  const handleAmountChange = (e) => {
    const text = e.target.value;
    setAmountText(text);
    const value = parseAmount(text);
    if (value === null) {
      setAmountInvalid(true);
      return;
    }
    setAmountInvalid(false);
    setAmount(value);
    setCurrencyPrefs({ amount: value });
  };

  // Shows the committed amount nicely formatted; an invalid entry reverts to it.
  const handleAmountBlur = () => {
    setAmountText(amountFormat.format(amount));
    setAmountInvalid(false);
  };

  const handleAmountKeyDown = (e) => {
    if (e.key === 'Enter') e.currentTarget.blur();
  };

  const changeFrom = (code) => {
    setFrom(code);
    setCurrencyPrefs({ from: code });
  };

  const changeTo = (code) => {
    setTo(code);
    setCurrencyPrefs({ to: code });
  };

  const swapCurrencies = () => {
    setFrom(to);
    setTo(from);
    setCurrencyPrefs({ from: to, to: from });
    setSwapTurns((turns) => turns + 1);
  };

  const fromCurrency = getCurrency(from);
  const toCurrency = getCurrency(to);
  const ready = Boolean(conversion && conversion.from === from && conversion.to === to);
  const failureMessage = !ready && failure?.key === requestKey ? failure.message : null;
  const loading = !ready && !failureMessage;
  const stale = ready && conversion.stale;

  const valueText = ready && !amountInvalid
    ? formatMoney(conversion.result, to, { compact: !isExpanded })
    : '—';
  const valueSize = isExpanded ? fitFontSize(valueText, 56, 288) : fitFontSize(valueText, 32, 126);
  const rateText = ready ? `1 ${from} = ${formatRate(conversion.rate)} ${to}` : '';
  const updatedText = ready
    ? stale
      ? `${conversion.staleReason === 'error' ? 'Couldn’t refresh' : 'Offline'} · last updated ${formatClock(conversion.updatedAt, now)}`
      : `Updated ${formatRelative(conversion.updatedAt, now)}`
    : '';

  const historyReady = history?.pair === pairKey;
  const points = historyReady ? history.points : null;
  const trend = describeTrend(points);
  const rates = points ? points.map((point) => point.rate) : null;
  const amountMessage = amountInvalid && amountText.trim() ? 'Enter a valid amount.' : '';

  return (
    <div
      ref={cardRef}
      className={`cw-card cw-mood-${trend?.direction ?? 'flat'}${isExpanded ? ' cw-expanded' : ''}`}
      onClick={toggleExpand}
      onKeyDown={handleCardKeyDown}
    >
      <div className="cw-main">
        <div className="cw-top">
          <button
            ref={headerRef}
            type="button"
            className="cw-header"
            aria-expanded={isExpanded}
            aria-controls={controlsId}
            aria-label={`Currency converter, ${fromCurrency?.name ?? from} to ${toCurrency?.name ?? to}`}
          >
            <span className="cw-flag">{fromCurrency ? getCurrencySymbol(fromCurrency.code) : ''}</span>
            <span>{from}</span>
            <span className="cw-arrow">→</span>
            <span className="cw-flag">{toCurrency ? getCurrencySymbol(toCurrency.code) : ''}</span>
            <span>{to}</span>
          </button>

          {loading && <span className="cw-shimmer cw-shimmer-value" aria-label="Loading exchange rate" role="img" />}
          {failureMessage && (
            <div className="cw-error" role="alert">
              <span>{failureMessage}</span>
              <button
                type="button"
                className="cw-retry"
                onClick={(e) => {
                  e.stopPropagation();
                  setRetryCount((count) => count + 1);
                }}
              >
                Try again
              </button>
            </div>
          )}
          {ready && (
            <span
              className="cw-value"
              style={{ fontSize: valueSize }}
              aria-live={isExpanded ? 'polite' : 'off'}
            >
              {valueText}
            </span>
          )}
        </div>

        <div className="cw-bottom">
          {loading && <span className="cw-shimmer cw-shimmer-line" aria-hidden="true" />}
          {ready && trend && (
            <div className={`cw-trend cw-dir-${trend.direction}`}>
              <Sparkline values={rates} width={100} height={22} className="cw-spark-mini" />
              <span className={`cw-change cw-change-${trend.direction}`} aria-label={trend.label}>
                {trend.text}
              </span>
            </div>
          )}
          {ready && <span className="cw-rate">{rateText}</span>}
          {stale && <span className="cw-status">{updatedText}</span>}
        </div>
      </div>

      <div
        className="cw-controls"
        ref={controlsRef}
        id={controlsId}
        onClick={stopPropagation}
        data-stack-no-flip
      >
        <label className={`cw-field${amountMessage ? ' cw-field-invalid' : ''}`} htmlFor={amountId}>
          <span className="cw-sr-only">Amount in {fromCurrency?.name ?? from}</span>
          <input
            id={amountId}
            className="cw-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={amountText}
            onChange={handleAmountChange}
            onBlur={handleAmountBlur}
            onKeyDown={handleAmountKeyDown}
            aria-invalid={amountMessage ? true : undefined}
            data-stack-no-flip
          />
          <span className="cw-field-suffix" aria-hidden="true">{from}</span>
        </label>
        {amountMessage && <span className="cw-field-message" role="alert">{amountMessage}</span>}

        <div className="cw-pickers">
          <CurrencyPicker label="From currency" value={from} onChange={changeFrom} />
          <CurrencyPicker label="To currency" value={to} onChange={changeTo} />
          <button
            type="button"
            className="cw-swap"
            style={{ '--cw-swap-turn': `${swapTurns * 180}deg` }}
            onClick={swapCurrencies}
            aria-label="Swap currencies"
            data-stack-no-flip
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="M5 13V3M5 3 2.5 5.5M5 3l2.5 2.5M11 3v10m0 0-2.5-2.5M11 13l2.5-2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className="cw-divider" ref={dividerRef} />

      <div className="cw-details" ref={detailsRef} onClick={stopPropagation} data-stack-no-flip>
        <div className="cw-chart-head">
          <span>{HISTORY_DAYS}-day trend</span>
          {trend && <span className={`cw-change cw-change-${trend.direction}`}>{trend.text}</span>}
        </div>
        {!historyReady && <span className="cw-shimmer cw-shimmer-chart" aria-hidden="true" />}
        {historyReady && points && (
          <div className={`cw-chart${trend ? ` cw-dir-${trend.direction}` : ''}`}>
            <Sparkline values={rates} width={240} height={64} className="cw-spark-large" />
            <div className="cw-chart-scale">
              <span aria-label={`High ${formatRate(trend.max)}`}>{formatRate(trend.max)}</span>
              <span aria-label={`Low ${formatRate(trend.min)}`}>{formatRate(trend.min)}</span>
            </div>
            <div className="cw-chart-dates">
              <span>{formatDay(points[0].date)}</span>
              <span>{formatDay(points[points.length - 1].date)}</span>
            </div>
          </div>
        )}
        {historyReady && !points && (
          <p className="cw-note">
            {from === to ? 'Choose two different currencies.' : 'No 7-day trend for this pair.'}
          </p>
        )}

        <div className="cw-footer">
          <span className={stale ? 'cw-updated cw-updated-offline' : 'cw-updated'}>{updatedText}</span>
          <a
            className="cw-attribution"
            href={ATTRIBUTION.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {ATTRIBUTION.label}
          </a>
        </div>
      </div>
    </div>
  );
}
