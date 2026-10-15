// Pure helpers for the Gold & Silver card (GoldWidget.jsx): what each metal shows under the
// current prefs, spoken summaries for screen readers, the intraday chart model and small
// formatting utilities. No React and no I/O, so they are unit-tested on their own.

import {
  DEFAULT_DUTY_PCT,
  PURITIES,
  SOVEREIGN_GRAMS,
  formatChangePercent,
  formatPrice,
  metalPrice,
} from '../../libs/markets/marketService.js';

// Same bounds as getMetalPrefs() in marketService.
export const MAX_DUTY_PCT = 50;
const GRAMS_PER_KG = 1000;

export const MODE_LABELS = {
  retail: { short: 'Retail est.', spoken: 'retail estimate' },
  spot: { short: 'Intl.', spoken: 'international price' },
};

const SOURCE_LABELS = {
  comex: 'International (COMEX)',
  'daily-spot': 'Daily spot',
};

const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const clockFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

// ---------------------------------------------------------------------------
// Prefs

/** Normalizes prefs carried by the metals:prefs event (same rules as getMetalPrefs()). */
export function normalizeMetalPrefs(raw) {
  const duty = Number(raw?.dutyPct);
  return {
    mode: raw?.mode === 'spot' ? 'spot' : 'retail',
    dutyPct: Number.isFinite(duty) && duty >= 0 && duty <= MAX_DUTY_PCT ? duty : DEFAULT_DUTY_PCT,
    purity: PURITIES.some((p) => p.id === raw?.purity) ? raw.purity : PURITIES[0].id,
  };
}

/** Import-duty field text → percent (0–50, at most 2 decimals), or null when invalid. */
export function parseDuty(text) {
  const normalized = String(text ?? '').trim().replace(',', '.');
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(normalized)) return null;
  const value = Number(normalized);
  return value >= 0 && value <= MAX_DUTY_PCT ? value : null;
}

/** 6 → "6", 7.5 → "7.5". */
export function formatDuty(value) {
  return String(Number(value.toFixed(2)));
}

// ---------------------------------------------------------------------------
// Time

export function formatRelative(timestamp, now) {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return relativeFormat.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return relativeFormat.format(-hours, 'hour');
  return relativeFormat.format(-Math.round(hours / 24), 'day');
}

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

/** "3:05 PM" today, "Oct 14, 3:05 PM" on another day. */
export function formatClock(timestamp, now) {
  const date = new Date(timestamp);
  return sameDay(timestamp, now) ? clockFormat.format(date) : `${dayFormat.format(date)}, ${clockFormat.format(date)}`;
}

/** 'YYYY-MM-DD' → "Oct 14". */
export function formatDay(isoDate) {
  return dayFormat.format(new Date(`${isoDate}T00:00:00`));
}

/** Footer line ("Updated 2 minutes ago" / "Offline · last updated 3:05 PM") and the short tile line. */
export function describeUpdated(fetchedAt, stale, now) {
  if (!isNumber(fetchedAt)) return { full: '', short: '' };
  if (!stale) {
    const text = `Updated ${formatRelative(fetchedAt, now)}`;
    return { full: text, short: text };
  }
  const clock = formatClock(fetchedAt, now);
  return { full: `Offline · last updated ${clock}`, short: `Offline · ${clock}` };
}

/** "International (COMEX)" or "Daily spot · Oct 14". */
export function describeSource(source, date) {
  if (source === 'daily-spot') return date ? `${SOURCE_LABELS['daily-spot']} · ${formatDay(date)}` : SOURCE_LABELS['daily-spot'];
  return SOURCE_LABELS[source] || SOURCE_LABELS.comex;
}

// ---------------------------------------------------------------------------
// Prices

/** Change pill text and its spoken form, or null when there is no previous close. */
export function describeChange(quote) {
  if (!isNumber(quote?.changePercent)) return null;
  const text = formatChangePercent(quote.changePercent);
  const direction = quote.direction === 'up' || quote.direction === 'down' ? quote.direction : 'flat';
  const magnitude = text.replace(/^[▲▼]\s*/, '');
  return { text, direction, spoken: direction === 'flat' ? 'unchanged today' : `${direction} ${magnitude} today` };
}

/**
 * What the card shows for one metal under prefs { mode, dutyPct, purity }.
 * quote.price is the international INR price per gram of 24K gold / fine silver;
 * silver ignores purity.
 */
export function describeMetal(symbol, quote, prefs) {
  const gold = symbol === 'GOLD';
  const purity = gold ? prefs.purity : PURITIES[0].id;
  const price = (grams, grade = purity) => metalPrice(quote?.price, { grams, purity: grade, mode: prefs.mode, dutyPct: prefs.dutyPct });
  const label = gold ? `Gold ${purity}` : 'Silver';
  const change = describeChange(quote);

  // Tile headline: gold per gram without paise ("₹13,891"), silver per kg in lakhs ("₹1.87L").
  const headlineValue = gold ? price(1) : price(GRAMS_PER_KG);
  const headline = {
    value: headlineValue,
    text: formatPrice(headlineValue, gold ? { digits: 0 } : { compact: true }),
    unit: headlineValue === null ? '' : gold ? '/g' : '/kg',
  };

  const spokenPrice = `${formatPrice(headlineValue, { digits: 0 })} ${gold ? 'per gram' : 'per kilogram'}`;
  const summary = headlineValue === null
    ? `${label}, price unavailable`
    : [label, spokenPrice, MODE_LABELS[prefs.mode].spoken, change?.spoken].filter(Boolean).join(', ');

  const rows = gold
    ? [
        { id: 'gram', label: `Per gram (${purity})`, text: formatPrice(price(1)) },
        { id: 'sovereign', label: `Sovereign · ${SOVEREIGN_GRAMS} g 22K`, text: formatPrice(price(SOVEREIGN_GRAMS, '22K'), { digits: 0 }) },
      ]
    : [
        { id: 'gram', label: 'Per gram', text: formatPrice(price(1)) },
        { id: 'kg', label: 'Per kg', text: formatPrice(price(GRAMS_PER_KG), { digits: 0 }) },
      ];

  return { symbol, label, headline, change, summary, rows };
}

// ---------------------------------------------------------------------------
// Chart

/** Intraday series of a quote (raw INR per gram), or null with fewer than two points. */
export function intradayChart(quote) {
  const points = Array.isArray(quote?.points)
    ? quote.points.filter((point) => Array.isArray(point) && isNumber(point[0]) && isNumber(point[1]))
    : [];
  if (points.length < 2) return null;
  const values = points.map((point) => point[1]);
  return {
    values,
    baseline: isNumber(quote.previousClose) ? quote.previousClose : null,
    high: Math.max(...values),
    low: Math.min(...values),
    start: points[0][0] * 1000,
    end: points[points.length - 1][0] * 1000,
  };
}

/** High / low chart labels per gram in the card's prefs (gold without paise, silver with). */
export function chartScale(symbol, chart, prefs) {
  const gold = symbol === 'GOLD';
  const format = (value) => formatPrice(
    metalPrice(value, { grams: 1, purity: gold ? prefs.purity : PURITIES[0].id, mode: prefs.mode, dutyPct: prefs.dutyPct }),
    { digits: gold ? 0 : 2 },
  );
  return { high: format(chart.high), low: format(chart.low) };
}

/** "Today" for today's session, otherwise its date ("Oct 14"). */
export function chartTitle(end, now) {
  return sameDay(end, now) ? 'Today' : dayFormat.format(new Date(end));
}

// ---------------------------------------------------------------------------
// Layout

/** Shrinks long values so they never overflow the tile (≈0.6em per glyph), as on the currency card. */
export function fitFontSize(text, max, available) {
  const estimate = Math.floor(available / (Math.max(text.length, 1) * 0.6));
  return Math.max(Math.round(max / 2), Math.min(max, estimate));
}
