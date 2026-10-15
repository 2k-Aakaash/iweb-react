import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatPointTime, layoutChart, nearestIndex, prepareSeries } from './chartMath';

// Interactive price chart for the Markets app: inline SVG (no chart library) that fills its
// container's width, an area + line coloured by direction, a dashed previous-close line on
// 1D, high/low and time labels, and a crosshair driven by the pointer, touch or the keyboard
// (a slider: arrows, Page Up/Down, Home/End). The maths lives in chartMath.js.

const DEFAULT_HEIGHT = 260;
const TIP_HALF_WIDTH = 76;
const PAGE_FRACTION = 0.1;

function isFocusVisible(element) {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

export default function PriceChart({
  points,
  rangeId,
  timeZone,
  reference = null,
  showReference = false,
  session = null,
  direction = 'flat',
  label,
  formatValue,
  formatAxisValue,
  height = DEFAULT_HEIGHT,
  refreshing = false,
}) {
  // The frame is always rendered (with or without data), so the observer stays attached.
  const frameRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState(null);
  const gradientId = `mk-chart-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const hintId = useId();

  // Responsive width: the SVG is drawn at the frame's pixel size (crisp 1px hairlines).
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0].contentRect.width);
      setWidth((prev) => (prev === next ? prev : next));
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const series = useMemo(
    () => prepareSeries({ points, rangeId, timeZone, reference, includeReference: showReference, session }),
    [points, rangeId, timeZone, reference, showReference, session],
  );
  const model = useMemo(
    () => (series && width > 0 ? layoutChart(series, { width, height }) : null),
    [series, width, height],
  );

  const count = series ? series.picked.length : 0;
  const lastIndex = count - 1;
  const activeIndex = active === null || !count ? null : Math.min(active, lastIndex);
  const readIndex = activeIndex ?? lastIndex;
  const readPoint = count
    ? { t: series.times[series.picked[readIndex]], value: series.values[series.picked[readIndex]] }
    : null;

  const indexAt = (clientX) => {
    if (!model || !frameRef.current) return -1;
    return nearestIndex(model.xs, clientX - frameRef.current.getBoundingClientRect().left);
  };

  const handlePointerMove = (e) => {
    const index = indexAt(e.clientX);
    if (index >= 0) setActive(index);
  };

  // Touch and pen scrub while pressed (horizontal drags; vertical ones still scroll).
  const handlePointerDown = (e) => {
    if (e.pointerType === 'mouse') return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    handlePointerMove(e);
  };

  const handlePointerUp = (e) => {
    if (e.pointerType !== 'mouse') setActive(null);
  };

  const handlePointerLeave = (e) => {
    if (e.pointerType === 'mouse') setActive(null);
  };

  const handleKeyDown = (e) => {
    if (!count) return;
    const page = Math.max(1, Math.round(count * PAGE_FRACTION));
    const current = activeIndex ?? lastIndex;
    let next;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = current - 1;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        next = current + 1;
        break;
      case 'PageDown':
        next = current - page;
        break;
      case 'PageUp':
        next = current + page;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = lastIndex;
        break;
      default:
        return;
    }
    e.preventDefault();
    setActive(Math.max(0, Math.min(lastIndex, next)));
  };

  // Keyboard focus shows the crosshair on the latest point; a click positions it itself.
  const handleFocus = (e) => {
    if (count && isFocusVisible(e.currentTarget)) setActive((prev) => prev ?? lastIndex);
  };

  const handleBlur = () => setActive(null);

  const activePoint = model && activeIndex !== null ? model.points[activeIndex] : null;
  const tipLeft = activePoint
    ? Math.min(Math.max(activePoint.x, TIP_HALF_WIDTH), Math.max(TIP_HALF_WIDTH, width - TIP_HALF_WIDTH))
    : 0;

  const interactive = series
    ? {
      role: 'slider',
      tabIndex: 0,
      'aria-label': label,
      'aria-describedby': hintId,
      'aria-orientation': 'horizontal',
      'aria-valuemin': 0,
      'aria-valuemax': lastIndex,
      'aria-valuenow': readIndex,
      'aria-valuetext': `${formatValue(readPoint.value)} at ${formatPointTime(readPoint.t, rangeId, series.timeZone)}`,
      'aria-busy': refreshing || undefined,
      onPointerMove: handlePointerMove,
      onPointerDown: handlePointerDown,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerUp,
      onPointerLeave: handlePointerLeave,
      onKeyDown: handleKeyDown,
      onFocus: handleFocus,
      onBlur: handleBlur,
    }
    : {};

  return (
    <>
      <div
        ref={frameRef}
        className={`mk-chart mk-dir-${direction}${series ? '' : ' mk-chart-empty'}${refreshing ? ' is-refreshing' : ''}`}
        style={{ height }}
        {...interactive}
      >
        {!series && <p className="mk-chart-note">No chart data for this range.</p>}

        {model && (
          <svg
            className="mk-chart-svg"
            width={model.width}
            height={model.height}
            viewBox={`0 0 ${model.width} ${model.height}`}
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" className="mk-chart-fill-top" />
                <stop offset="100%" className="mk-chart-fill-bottom" />
              </linearGradient>
            </defs>

            {model.yLabels.map((item) => (
              <line
                key={`grid-${item.id}`}
                className="mk-chart-grid"
                x1={model.plot.left}
                x2={model.plot.right}
                y1={Math.round(item.y) + 0.5}
                y2={Math.round(item.y) + 0.5}
              />
            ))}
            {model.ticks.map((tick) => (
              <line
                key={`tick-${tick.t}`}
                className="mk-chart-grid"
                x1={Math.round(tick.x) + 0.5}
                x2={Math.round(tick.x) + 0.5}
                y1={model.plot.top}
                y2={model.plot.bottom}
              />
            ))}

            <path className="mk-chart-area" d={model.area} fill={`url(#${gradientId})`} />
            {model.referenceY !== null && (
              <line
                className="mk-chart-reference"
                x1={model.plot.left}
                x2={model.plot.right}
                y1={model.referenceY}
                y2={model.referenceY}
              />
            )}
            <path className="mk-chart-line" d={model.line} />

            {activePoint && (
              <g>
                <line
                  className="mk-chart-crosshair"
                  x1={activePoint.x}
                  x2={activePoint.x}
                  y1={model.plot.top - 6}
                  y2={model.plot.bottom}
                />
                <circle className="mk-chart-dot" cx={activePoint.x} cy={activePoint.y} r="4.5" />
              </g>
            )}

            {model.ticks.map((tick) => (
              <text
                key={`label-${tick.t}`}
                className="mk-chart-xlabel"
                x={tick.x}
                y={model.height - 7}
                textAnchor={tick.anchor}
              >
                {tick.label}
              </text>
            ))}
            {model.yLabels.map((item) => (
              <text
                key={`value-${item.id}`}
                className="mk-chart-ylabel"
                x={model.plot.right + 8}
                y={item.y}
                dominantBaseline="middle"
              >
                {formatAxisValue(item.value)}
              </text>
            ))}
          </svg>
        )}

        {activePoint && (
          <div className="mk-chart-tip" style={{ left: tipLeft }} aria-hidden="true">
            <span className="mk-chart-tip-value">{formatValue(activePoint.value)}</span>
            <span className="mk-chart-tip-time">{formatPointTime(activePoint.t, rangeId, series.timeZone)}</span>
          </div>
        )}
      </div>
      {series && (
        <p id={hintId} className="mk-sr-only">Use the arrow keys, Home and End to read prices along the chart.</p>
      )}
    </>
  );
}
