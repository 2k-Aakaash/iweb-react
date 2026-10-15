// Pure maths for the Markets app price chart: downsampling, scales, nearest-point lookup,
// time ticks in the exchange's time zone and SVG paths. No DOM and no React, so all of
// it is unit-tested (see __tests__/chartMath.test.js).

export const MAX_CHART_POINTS = 500;
export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';
export const DEFAULT_PADDING = { top: 30, right: 64, bottom: 24, left: 2 };

// Minimum horizontal room per x-axis label, in px.
const MIN_TICK_SPACING = 72;
const INTRADAY_STEPS = [15, 30, 60, 120, 180, 240, 360, 720]; // minutes
// A session domain is used for 1D only when the points fall inside it (Yahoo's 1D
// chart shows the previous session until the market opens).
const SESSION_TOLERANCE = 3600; // s

// How each range is laid out. 1D is time-based (the line stops at the current time inside
// the full session, like macOS Stocks); longer ranges are spaced by point index so nights,
// weekends and holidays don't stretch the line into flat gaps.
export const RANGE_AXIS = {
  '1d': { scale: 'time', tick: 'time' },
  '5d': { scale: 'index', unit: 'day', tick: 'weekday', includeFirst: true },
  '1mo': { scale: 'index', unit: 'day', tick: 'day', includeFirst: true },
  '6mo': { scale: 'index', unit: 'month', tick: 'month' },
  ytd: { scale: 'index', unit: 'month', tick: 'month', includeFirst: true },
  '1y': { scale: 'index', unit: 'month', tick: 'month' },
  '5y': { scale: 'index', unit: 'year', tick: 'year' },
};

// ---------------------------------------------------------------------------
// Numbers

export function extent(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min <= max ? [min, max] : null;
}

/** Widens [min, max] by `ratio` of its span on both sides (1% of the value when flat). */
export function padDomain([min, max], ratio = 0.1) {
  if (max === min) {
    const pad = Math.abs(min) * 0.01 || 1;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * ratio;
  return [min - pad, max + pad];
}

/** d3-style linear scale: scale(v) maps the domain onto the range; scale.invert reverses it. */
export function linearScale([d0, d1], [r0, r1]) {
  const span = d1 - d0;
  const factor = span === 0 ? 0 : (r1 - r0) / span;
  const scale = (value) => (span === 0 ? (r0 + r1) / 2 : r0 + (value - d0) * factor);
  scale.invert = (position) => (factor === 0 ? d0 : d0 + (position - r0) / factor);
  return scale;
}

/** Index of the value closest to `target` in an ascending array (-1 when empty; ties go left). */
export function nearestIndex(sorted, target) {
  const count = sorted.length;
  if (!count || !Number.isFinite(target)) return count ? 0 : -1;
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(sorted[lo - 1] - target) <= Math.abs(sorted[lo] - target)) return lo - 1;
  return lo;
}

/**
 * Indices of at most `max` values chosen with Largest-Triangle-Three-Buckets (x = index):
 * keeps the first and last points and the visually significant peaks and dips.
 */
export function downsampleIndices(values, max = MAX_CHART_POINTS) {
  const count = values.length;
  const limit = Math.max(3, Math.floor(max));
  if (count <= limit) return Array.from({ length: count }, (_, i) => i);

  const picked = [0];
  const bucket = (count - 2) / (limit - 2);
  let a = 0;
  for (let b = 0; b < limit - 2; b += 1) {
    // Average of the next bucket (the third corner of the triangle).
    const nextStart = Math.floor((b + 1) * bucket) + 1;
    const nextEnd = Math.min(Math.floor((b + 2) * bucket) + 1, count);
    let avgX = 0;
    let avgY = 0;
    for (let j = nextStart; j < nextEnd; j += 1) {
      avgX += j;
      avgY += values[j];
    }
    const size = nextEnd - nextStart;
    avgX /= size;
    avgY /= size;

    // The point of this bucket that forms the largest triangle with `a` and that average.
    const start = Math.floor(b * bucket) + 1;
    const end = Math.floor((b + 1) * bucket) + 1;
    const ay = values[a];
    let best = start;
    let bestArea = -1;
    for (let j = start; j < end; j += 1) {
      const area = Math.abs((a - avgX) * (values[j] - ay) - (a - j) * (avgY - ay));
      if (area > bestArea) {
        bestArea = area;
        best = j;
      }
    }
    picked.push(best);
    a = best;
  }
  picked.push(count - 1);
  return picked;
}

// ---------------------------------------------------------------------------
// Time zones (exchange-local wall clock via Intl; no dependencies)

const partsFormats = new Map();
const labelFormats = new Map();
const zoneNameFormats = new Map();
const validZones = new Map();

/** The zone if Intl knows it, otherwise IST (the app's markets are Indian). */
export function resolveTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone) return DEFAULT_TIME_ZONE;
  if (!validZones.has(timeZone)) {
    let valid = true;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone });
    } catch {
      valid = false;
    }
    validZones.set(timeZone, valid);
  }
  return validZones.get(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
}

function partsFormat(timeZone) {
  let format = partsFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    partsFormats.set(timeZone, format);
  }
  return format;
}

/** Wall-clock { year, month, day, hour, minute, second } of epoch seconds in a time zone. */
export function zonedParts(tSec, timeZone) {
  const parts = {};
  for (const { type, value } of partsFormat(timeZone).formatToParts(new Date(tSec * 1000))) parts[type] = value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function offsetSeconds(tSec, timeZone) {
  const p = zonedParts(tSec, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000 - Math.floor(tSec);
}

/** Epoch seconds of a wall-clock time in a time zone (DST-aware). */
export function zonedTimeToEpoch({ year, month, day, hour = 0, minute = 0 }, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute) / 1000;
  const guess = wall - offsetSeconds(wall, timeZone);
  return wall - offsetSeconds(guess, timeZone);
}

function labelFormat(timeZone, options) {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let format = labelFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat('en-IN', { timeZone, ...options });
    labelFormats.set(key, format);
  }
  return format;
}

// Newer ICU versions put a narrow no-break space before "AM"; older ones a plain space.
// Normalised so labels are identical in every engine.
const normalizeSpaces = (text) => text.replace(/[\u00a0\u202f]/g, ' ');

function formatPlain(format, date) {
  return normalizeSpaces(format.format(date));
}

// en-IN writes "3:30 pm"; the app shows "3:30 PM".
function formatUpper(format, date) {
  return normalizeSpaces(format
    .formatToParts(date)
    .map((part) => (part.type === 'dayPeriod' ? part.value.toUpperCase() : part.value))
    .join(''));
}

/** Epoch seconds formatted in a time zone (en-IN, "PM" in capitals, plain spaces). */
export function formatInZone(tSec, timeZone, options) {
  return formatUpper(labelFormat(resolveTimeZone(timeZone), options), new Date(tSec * 1000));
}

/** Short zone name: "IST", "EDT", … (en-IN knows IST, en-US the American zones), else "GMT+x". */
export function zoneAbbreviation(tSec, timeZone) {
  const zone = resolveTimeZone(timeZone);
  const date = new Date(tSec * 1000);
  let fallback = '';
  for (const locale of ['en-IN', 'en-US']) {
    const key = `${locale}|${zone}`;
    let format = zoneNameFormats.get(key);
    if (!format) {
      format = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' });
      zoneNameFormats.set(key, format);
    }
    const name = format.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value || '';
    if (name && !/^(GMT|UTC)[+−-]/.test(name)) return name;
    fallback ||= name;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Ticks

/** Round wall-clock times (every 15 min … 12 h) between t0 and t1, at most `maxTicks`. */
export function intradayTicks(t0, t1, timeZone, maxTicks) {
  if (!(t1 > t0) || maxTicks < 1) return [];
  const spanMinutes = (t1 - t0) / 60;
  const step = INTRADAY_STEPS.find((minutes) => spanMinutes / minutes <= maxTicks) ?? 1440;
  const first = zonedParts(t0, timeZone);
  const last = zonedParts(t1, timeZone);
  const firstDay = Date.UTC(first.year, first.month - 1, first.day);
  const lastDay = Date.UTC(last.year, last.month - 1, last.day);
  const ticks = [];
  for (let day = firstDay; day <= lastDay; day += 86400000) {
    const date = new Date(day);
    const from = day === firstDay ? Math.ceil((first.hour * 60 + first.minute) / step) * step : 0;
    const to = day === lastDay ? last.hour * 60 + last.minute : 1439;
    for (let minute = from; minute <= to && minute < 1440; minute += step) {
      const t = zonedTimeToEpoch({
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: Math.floor(minute / 60),
        minute: minute % 60,
      }, timeZone);
      if (t >= t0 && t <= t1 && ticks[ticks.length - 1] !== t) ticks.push(t);
    }
  }
  return ticks;
}

/** Indices where the local day / month / year changes (optionally including index 0). */
export function boundaryTicks(times, unit, timeZone, { includeFirst = false } = {}) {
  const keyOf = (t) => {
    const p = zonedParts(t, timeZone);
    if (unit === 'year') return p.year;
    if (unit === 'month') return p.year * 12 + p.month;
    return p.year * 10000 + p.month * 100 + p.day;
  };
  const result = [];
  let previous = null;
  times.forEach((t, index) => {
    const key = keyOf(t);
    if (previous === null ? includeFirst : key !== previous) result.push(index);
    previous = key;
  });
  return result;
}

/** Keeps every n-th item so that at most `maxCount` remain. */
export function thinTicks(items, maxCount) {
  if (maxCount < 1) return [];
  if (items.length <= maxCount) return items;
  const stride = Math.ceil(items.length / maxCount);
  return items.filter((_, index) => index % stride === 0);
}

/** Drops ticks closer than `minGap` px to the previous kept one. */
export function spaceTicks(ticks, minGap) {
  const kept = [];
  for (const tick of ticks) {
    if (!kept.length || tick.x - kept[kept.length - 1].x >= minGap) kept.push(tick);
  }
  return kept;
}

/** Axis label: 'time' "10 AM" · 'weekday' "Thu 15" · 'day' "15 Oct" · 'month' "Oct" ("2026" in January) · 'year' "2026". */
export function formatTickLabel(tSec, kind, timeZone) {
  const zone = resolveTimeZone(timeZone);
  const date = new Date(tSec * 1000);
  switch (kind) {
    case 'time': {
      const { minute } = zonedParts(tSec, zone);
      return minute
        ? formatUpper(labelFormat(zone, { hour: 'numeric', minute: '2-digit' }), date)
        : formatUpper(labelFormat(zone, { hour: 'numeric' }), date);
    }
    case 'weekday':
      return formatPlain(labelFormat(zone, { weekday: 'short', day: 'numeric' }), date);
    case 'day':
      return formatPlain(labelFormat(zone, { day: 'numeric', month: 'short' }), date);
    case 'month': {
      const { month, year } = zonedParts(tSec, zone);
      return month === 1 ? String(year) : formatPlain(labelFormat(zone, { month: 'short' }), date);
    }
    default:
      return String(zonedParts(tSec, zone).year);
  }
}

/** Crosshair time: "2:15 PM" (1D) · "Thu, 15 Oct, 2:15 PM" (5D, 1M) · "15 Oct 2026" (longer). */
export function formatPointTime(tSec, rangeId, timeZone) {
  const zone = resolveTimeZone(timeZone);
  const date = new Date(tSec * 1000);
  if (rangeId === '1d') return formatUpper(labelFormat(zone, { hour: 'numeric', minute: '2-digit' }), date);
  if (rangeId === '5d' || rangeId === '1mo') {
    return formatUpper(labelFormat(zone, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }), date);
  }
  return formatPlain(labelFormat(zone, { day: 'numeric', month: 'short', year: 'numeric' }), date);
}

// ---------------------------------------------------------------------------
// Chart model

const round = (value) => Math.round(value * 10) / 10;

/** "M x,y L x,y …" through points ({ x, y }). */
export function linePath(points) {
  return points.map((p, index) => `${index ? 'L' : 'M'}${round(p.x)},${round(p.y)}`).join('');
}

/** The line closed down to `bottom`, for the area fill. */
export function areaPath(points, bottom) {
  if (!points.length) return '';
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath(points)}L${round(last.x)},${round(bottom)}L${round(first.x)},${round(bottom)}Z`;
}

/**
 * Size-independent part of the chart: cleaned data, the drawn subset (≤ maxPoints),
 * value range (including the reference when it is drawn), x domain and boundary ticks.
 * Returns null when there is nothing to draw.
 */
export function prepareSeries({
  points,
  rangeId,
  timeZone,
  reference = null,
  includeReference = false,
  session = null,
  maxPoints = MAX_CHART_POINTS,
}) {
  const clean = Array.isArray(points)
    ? points.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    : [];
  if (!clean.length) return null;

  const zone = resolveTimeZone(timeZone);
  const axis = RANGE_AXIS[rangeId] || RANGE_AXIS['1d'];
  const times = clean.map((p) => p[0]);
  const values = clean.map((p) => p[1]);
  const [min, max] = extent(values);
  const hasReference = Number.isFinite(reference);
  const drawReference = includeReference && hasReference;
  const yExtent = drawReference ? [Math.min(min, reference), Math.max(max, reference)] : [min, max];

  let xDomain;
  if (axis.scale === 'time') {
    const first = times[0];
    const last = times[times.length - 1];
    const start = session?.start;
    const end = session?.end;
    const inSession = Number.isFinite(start) && Number.isFinite(end) && end > start
      && first >= start - SESSION_TOLERANCE && last <= end + SESSION_TOLERANCE;
    xDomain = inSession ? [Math.min(first, start), Math.max(last, end)] : [first, last];
    if (xDomain[0] === xDomain[1]) xDomain = [xDomain[0] - 1800, xDomain[1] + 1800];
  } else {
    xDomain = clean.length > 1 ? [0, clean.length - 1] : [-1, 1];
  }

  return {
    rangeId,
    timeZone: zone,
    axis,
    times,
    values,
    picked: downsampleIndices(values, maxPoints),
    min,
    max,
    first: values[0],
    last: values[values.length - 1],
    reference: hasReference ? reference : null,
    drawReference,
    xDomain,
    yDomain: padDomain(yExtent, 0.1),
    boundaries: axis.scale === 'index'
      ? boundaryTicks(times, axis.unit, zone, { includeFirst: axis.includeFirst })
      : null,
  };
}

/** Pixel layout of a prepared series: drawn points, paths, axis ticks and labels. */
export function layoutChart(series, { width, height, padding = DEFAULT_PADDING }) {
  const plot = {
    left: padding.left,
    right: Math.max(padding.left + 1, width - padding.right),
    top: padding.top,
    bottom: Math.max(padding.top + 1, height - padding.bottom),
  };
  const x = linearScale(series.xDomain, [plot.left, plot.right]);
  const y = linearScale(series.yDomain, [plot.bottom, plot.top]);
  const timeScale = series.axis.scale === 'time';

  const points = series.picked.map((index) => ({
    index,
    t: series.times[index],
    value: series.values[index],
    x: x(timeScale ? series.times[index] : index),
    y: y(series.values[index]),
  }));

  const maxTicks = Math.max(2, Math.floor((plot.right - plot.left) / MIN_TICK_SPACING));
  const rawTicks = timeScale
    ? intradayTicks(series.xDomain[0], series.xDomain[1], series.timeZone, maxTicks).map((t) => ({ t, x: x(t) }))
    : thinTicks(series.boundaries, maxTicks).map((index) => ({ t: series.times[index], x: x(index) }));
  const edge = MIN_TICK_SPACING / 2.5;
  const ticks = spaceTicks(rawTicks, MIN_TICK_SPACING).map((tick) => ({
    ...tick,
    label: formatTickLabel(tick.t, series.axis.tick, series.timeZone),
    anchor: tick.x - plot.left < edge ? 'start' : plot.right - tick.x < edge ? 'end' : 'middle',
  }));

  const yLabels = series.max === series.min
    ? [{ id: 'max', value: series.max, y: y(series.max) }]
    : [
      { id: 'max', value: series.max, y: y(series.max) },
      { id: 'min', value: series.min, y: y(series.min) },
    ];

  return {
    width,
    height,
    plot,
    points,
    xs: points.map((p) => p.x),
    line: linePath(points),
    area: areaPath(points, plot.bottom),
    ticks,
    yLabels,
    referenceY: series.drawReference ? y(series.reference) : null,
  };
}
