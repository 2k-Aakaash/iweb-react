import { useEffect, useId, useRef, useState } from 'react';
import Sparkline from './shared/Sparkline';
import { useCardExpand } from './shared/useCardExpand';
import {
  GST_PCT,
  METAL_PREFS_EVENT,
  MarketError,
  PURITIES,
  getMetalPrefs,
  getMetalQuotes,
  openMarkets,
  setMetalPrefs,
} from '../../libs/markets/marketService';
import {
  MAX_DUTY_PCT,
  MODE_LABELS,
  chartScale,
  chartTitle,
  describeMetal,
  describeSource,
  describeUpdated,
  fitFontSize,
  formatClock,
  formatDuty,
  intradayChart,
  normalizeMetalPrefs,
  parseDuty,
} from './goldFormat';
import '../../styles/gold-widget.css';

// Gold & Silver card for the Smart Stack: a glanceable 150×150 tile (gold per gram, silver
// per kg, in the saved Retail / Spot mode) that expands like the Currency card (shared
// useCardExpand) into metal, mode, purity and duty controls, unit prices and the intraday chart.

const REFRESH_MS = 5 * 60 * 1000;
const TICK_MS = 30 * 1000;
// localStorage key marketService keeps the prefs under (other tabs signal through 'storage').
const PREFS_STORAGE_KEY = 'metalPrefs';
// Tile headline: at most 26px, within the 124px content box minus the "/g" suffix.
const GOLD_VALUE_MAX = 26;
const GOLD_VALUE_SPACE = 110;
const DISCLAIMER = 'Indicative · jeweller rates add making charges';

const METAL_OPTIONS = [
  { id: 'GOLD', label: 'Gold' },
  { id: 'SILVER', label: 'Silver' },
];
const MODE_OPTIONS = [
  { id: 'spot', label: 'Spot' },
  { id: 'retail', label: 'Retail' },
];
const ARROW_STEPS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

const stopPropagation = (e) => e.stopPropagation();
const isPageVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

function failureText(err) {
  return err instanceof MarketError ? err.message : 'Couldn’t load metal prices. Please try again.';
}

// Segmented control: a radiogroup with roving focus (arrow keys, Home / End).
function Segmented({ label, options, value, onChange }) {
  const handleKeyDown = (e) => {
    const current = options.findIndex((option) => option.id === value);
    let next;
    if (ARROW_STEPS[e.key]) next = (current + ARROW_STEPS[e.key] + options.length) % options.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    else return;
    e.preventDefault();
    onChange(options[next].id);
    e.currentTarget.querySelectorAll('[role="radio"]')[next]?.focus();
  };

  return (
    <div className="gw-segmented" role="radiogroup" aria-label={label} onKeyDown={handleKeyDown}>
      {options.map((option) => {
        const checked = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            className="gw-segment"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={(e) => {
              e.stopPropagation();
              onChange(option.id);
            }}
            data-stack-no-flip
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default function GoldWidget({ active = true, onExpandedChange }) {
  const [prefs, setPrefs] = useState(getMetalPrefs);
  const [dutyText, setDutyText] = useState(() => formatDuty(prefs.dutyPct));
  const [metal, setMetal] = useState('GOLD');
  const [data, setData] = useState(null);
  const [failure, setFailure] = useState(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [pageVisible, setPageVisible] = useState(isPageVisible);
  const [now, setNow] = useState(() => Date.now());
  const [isExpanded, setIsExpanded] = useState(false);

  const cardRef = useRef(null);
  const headerRef = useRef(null);
  const controlsRef = useRef(null);
  const dividerRef = useRef(null);
  const detailsRef = useRef(null);
  const hasDataRef = useRef(false);

  const controlsId = useId();
  const detailsId = useId();
  const dutyId = useId();
  const dutyHintId = useId();

  useEffect(() => {
    onExpandedChange?.(isExpanded);
  }, [isExpanded, onExpandedChange]);

  // Follow prefs changed elsewhere (Markets app, Spotlight, other tabs). Our own changes echo
  // back here as well: the duty text is kept while it still parses to the stored value, so
  // typing "7." isn't reformatted under the caret.
  useEffect(() => {
    const apply = (next) => {
      setPrefs(next);
      setDutyText((text) => (parseDuty(text) === next.dutyPct ? text : formatDuty(next.dutyPct)));
    };
    const onPrefs = (e) => apply(normalizeMetalPrefs(e.detail ?? getMetalPrefs()));
    const onStorage = (e) => {
      if (e.key === PREFS_STORAGE_KEY || e.key === null) apply(getMetalPrefs());
    };
    window.addEventListener(METAL_PREFS_EVENT, onPrefs);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(METAL_PREFS_EVENT, onPrefs);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Quotes: on mount (so the card is ready before it's flipped to), whenever it becomes active
  // and on every reload (poll, page visible again, back online, retry). The service caches, so
  // most of these never hit the network. Becoming inactive keeps what we have; a newer request
  // or unmounting aborts the one in flight.
  useEffect(() => {
    if (!active && hasDataRef.current) return undefined;
    const controller = new AbortController();
    getMetalQuotes({ signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        hasDataRef.current = true;
        setData(result);
        setFailure(null);
        setNow(Date.now());
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'AbortError') return;
        setFailure(failureText(err));
        // Keep showing the last prices, flagged as not current.
        setData((prev) => (prev && !prev.stale ? { ...prev, stale: true } : prev));
      });
    return () => controller.abort();
  }, [active, reloadCount]);

  // While shown (active and the page visible): refresh every 5 minutes and keep
  // "Updated … ago" current. Paused when the card is flipped away or the tab is hidden.
  useEffect(() => {
    if (!active || !pageVisible) return undefined;
    const refresh = setInterval(() => setReloadCount((count) => count + 1), REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [active, pageVisible]);

  // Reload when the tab is visible again or the connection comes back (skipped while inactive).
  useEffect(() => {
    const handleVisibility = () => {
      const visible = isPageVisible();
      setPageVisible(visible);
      if (visible) setReloadCount((count) => count + 1);
    };
    const handleOnline = () => {
      setFailure(null);
      setReloadCount((count) => count + 1);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
    };
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

  const updatePrefs = (patch) => {
    setPrefs((current) => ({ ...current, ...patch }));
    setMetalPrefs(patch);
  };

  const handleDutyChange = (e) => {
    const text = e.target.value;
    setDutyText(text);
    const value = parseDuty(text);
    if (value !== null && value !== prefs.dutyPct) updatePrefs({ dutyPct: value });
  };

  // Shows the committed duty; an invalid entry reverts to it.
  const handleDutyBlur = () => setDutyText(formatDuty(prefs.dutyPct));

  const handleDutyKeyDown = (e) => {
    if (e.key === 'Enter') e.currentTarget.blur();
  };

  const retry = (e) => {
    e.stopPropagation();
    setFailure(null);
    setReloadCount((count) => count + 1);
  };

  const openInMarkets = (e) => {
    e.stopPropagation();
    openMarkets(metal);
  };

  const mode = MODE_LABELS[prefs.mode];
  const loading = !data && !failure;
  const failureMessage = data ? null : failure;
  const stale = Boolean(data?.stale);

  const gold = data ? describeMetal('GOLD', data.GOLD, prefs) : null;
  const silver = data ? describeMetal('SILVER', data.SILVER, prefs) : null;
  const goldChart = data ? intradayChart(data.GOLD) : null;
  const selected = metal === 'GOLD' ? gold : silver;
  const chart = metal === 'GOLD' ? goldChart : data && intradayChart(data.SILVER);
  const scale = chart ? chartScale(metal, chart, prefs) : null;
  const updated = data ? describeUpdated(Math.min(data.GOLD.fetchedAt, data.SILVER.fetchedAt), stale, now) : null;
  const goldValueSize = gold ? fitFontSize(gold.headline.text, GOLD_VALUE_MAX, GOLD_VALUE_SPACE) : GOLD_VALUE_MAX;
  const dutyMessage = parseDuty(dutyText) === null && dutyText.trim() ? `Enter 0–${MAX_DUTY_PCT}%.` : '';

  return (
    <div
      ref={cardRef}
      className={`cw-card gw-card${isExpanded ? ' cw-expanded' : ''}`}
      onClick={toggleExpand}
      onKeyDown={handleCardKeyDown}
    >
      <div className="cw-main">
        <div className="gw-top">
          <div className="gw-head">
            <button
              ref={headerRef}
              type="button"
              className="cw-header"
              aria-expanded={isExpanded}
              aria-controls={`${controlsId} ${detailsId}`}
              aria-label={`Gold & Silver, ${mode.spoken}`}
            >
              Gold &amp; Silver
            </button>
            <span className="gw-mode" aria-hidden="true">{mode.short}</span>
          </div>

          {loading && <span className="cw-shimmer cw-shimmer-value" role="img" aria-label="Loading gold and silver prices" />}
          {failureMessage && (
            <div className="cw-error" role="alert">
              <span>{failureMessage}</span>
              <button type="button" className="cw-retry" onClick={retry} data-stack-no-flip>
                Try again
              </button>
            </div>
          )}
          {gold && (
            <div className="gw-gold">
              <span className="cw-sr-only">{gold.summary}</span>
              <div aria-hidden="true">
                <span className="gw-label">{gold.label}</span>
                <span className="cw-value gw-value" style={{ fontSize: goldValueSize }}>
                  {gold.headline.text}
                  <span className="gw-unit">{gold.headline.unit}</span>
                </span>
                {(goldChart || gold.change) && (
                  <div className={`cw-trend gw-trend cw-dir-${gold.change?.direction ?? 'flat'}`}>
                    {goldChart && (
                      <Sparkline
                        values={goldChart.values}
                        baseline={goldChart.baseline}
                        width={72}
                        height={14}
                        className="cw-spark-mini gw-spark-mini"
                      />
                    )}
                    {gold.change && (
                      <span className={`cw-change cw-change-${gold.change.direction}`}>{gold.change.text}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="gw-bottom">
          {loading && <span className="cw-shimmer cw-shimmer-line" aria-hidden="true" />}
          {silver && (
            <div className="gw-silver">
              <span className="cw-sr-only">{silver.summary}</span>
              <div aria-hidden="true">
                <span className="gw-label">{silver.label}</span>
                <div className="gw-silver-row">
                  <span className="gw-silver-value">
                    {silver.headline.text}
                    <span className="gw-unit">{silver.headline.unit}</span>
                  </span>
                  {silver.change && (
                    <span className={`cw-change cw-change-${silver.change.direction}`}>{silver.change.text}</span>
                  )}
                </div>
              </div>
            </div>
          )}
          {stale && (
            <span className="cw-status gw-status">
              <span aria-hidden="true">{updated.short}</span>
              <span className="cw-sr-only">{updated.full}</span>
            </span>
          )}
        </div>
      </div>

      <div
        className="cw-controls gw-controls"
        ref={controlsRef}
        id={controlsId}
        onClick={stopPropagation}
        data-stack-no-flip
      >
        <div className="gw-control-row">
          <Segmented label="Metal" options={METAL_OPTIONS} value={metal} onChange={setMetal} />
          <Segmented
            label="Price type"
            options={MODE_OPTIONS}
            value={prefs.mode}
            onChange={(id) => updatePrefs({ mode: id })}
          />
        </div>

        {metal === 'GOLD' && (
          <div className="gw-chips" role="group" aria-label="Gold purity">
            {PURITIES.map((purity) => (
              <button
                key={purity.id}
                type="button"
                className="gw-chip"
                aria-pressed={prefs.purity === purity.id}
                onClick={(e) => {
                  e.stopPropagation();
                  updatePrefs({ purity: purity.id });
                }}
                data-stack-no-flip
              >
                {purity.label}
              </button>
            ))}
          </div>
        )}

        {prefs.mode === 'retail' && (
          <div className="gw-duty-row">
            <div className={`gw-duty${dutyMessage ? ' gw-duty-invalid' : ''}`}>
              <label htmlFor={dutyId}>Import duty</label>
              <input
                id={dutyId}
                className="gw-duty-input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                maxLength={5}
                value={dutyText}
                onChange={handleDutyChange}
                onBlur={handleDutyBlur}
                onKeyDown={handleDutyKeyDown}
                aria-invalid={dutyMessage ? true : undefined}
                aria-describedby={dutyHintId}
                data-stack-no-flip
              />
              <span id={dutyHintId}>% + GST {GST_PCT}%</span>
            </div>
            {dutyMessage && <span className="cw-field-message" role="alert">{dutyMessage}</span>}
          </div>
        )}
      </div>

      <div className="cw-divider" ref={dividerRef} />

      <div
        className="cw-details gw-details"
        ref={detailsRef}
        id={detailsId}
        onClick={stopPropagation}
        data-stack-no-flip
      >
        <span className="cw-sr-only" aria-live={isExpanded ? 'polite' : 'off'} aria-atomic="true">
          {selected?.summary ?? ''}
        </span>

        {loading && <span className="cw-shimmer gw-shimmer-rows" role="img" aria-label="Loading prices" />}
        {selected && (
          <dl className="gw-rows">
            {selected.rows.map((row) => (
              <div className="gw-row" key={row.id}>
                <dt>{row.label}</dt>
                <dd>{row.text}</dd>
              </div>
            ))}
          </dl>
        )}

        {selected && (chart || selected.change) && (
          <div className="cw-chart-head">
            <span>{chart ? chartTitle(chart.end, now) : 'Today'}</span>
            {selected.change && (
              <span className={`cw-change cw-change-${selected.change.direction}`}>
                <span aria-hidden="true">{selected.change.text}</span>
                <span className="cw-sr-only">{selected.change.spoken}</span>
              </span>
            )}
          </div>
        )}
        {chart && (
          <div className={`cw-chart cw-dir-${selected.change?.direction ?? 'flat'}`}>
            <Sparkline
              values={chart.values}
              baseline={chart.baseline}
              width={240}
              height={64}
              className="cw-spark-large"
            />
            <div className="cw-chart-scale">
              <span>
                <span className="cw-sr-only">High </span>
                {scale.high}
              </span>
              <span>
                <span className="cw-sr-only">Low </span>
                {scale.low}
              </span>
            </div>
            <div className="cw-chart-dates">
              <span>{formatClock(chart.start, now)}</span>
              <span>{formatClock(chart.end, now)}</span>
            </div>
          </div>
        )}
        {selected && !chart && (
          <p className="cw-note">
            {data.source === 'daily-spot' ? 'Daily spot — no intraday chart' : 'No intraday chart yet'}
          </p>
        )}

        <div className="cw-footer gw-footer">
          {data && <span className="gw-source">{describeSource(data.source, data.GOLD.date)}</span>}
          {data && <span className={stale ? 'cw-updated cw-updated-offline' : 'cw-updated'}>{updated.full}</span>}
          <span className="gw-disclaimer">{DISCLAIMER}</span>
          <div className="gw-footer-row">
            <span>Not investment advice</span>
            <button type="button" className="gw-open" onClick={openInMarkets} data-stack-no-flip>
              Open in Markets
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
