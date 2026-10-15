// Display helpers for the Markets app (Indian grouping via marketService's formatters).

import { MarketError, formatChange, formatPrice, isMetal } from '../../libs/markets/marketService';
import { formatInZone, resolveTimeZone, zoneAbbreviation, zonedParts } from './chartMath';

const FLAT_PERCENT = 0.005;
const percentFormat = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const RANGE_WORDS = {
  '1d': '1 day',
  '5d': '5 days',
  '1mo': '1 month',
  '6mo': '6 months',
  ytd: 'year to date',
  '1y': '1 year',
  '5y': '5 years',
};

export const RANGE_PERIODS = {
  '5d': 'past 5 days',
  '1mo': 'past month',
  '6mo': 'past 6 months',
  ytd: 'year to date',
  '1y': 'past year',
  '5y': 'past 5 years',
};

const TYPE_LABELS = {
  EQUITY: 'Stock',
  INDEX: 'Index',
  ETF: 'ETF',
  MUTUALFUND: 'Fund',
  FUTURE: 'Futures',
  METAL: 'Metal',
};

export const typeLabel = (type) => TYPE_LABELS[type] || '';

export function directionOfPercent(percent) {
  if (!Number.isFinite(percent) || Math.abs(percent) < FLAT_PERCENT) return 'flat';
  return percent > 0 ? 'up' : 'down';
}

/** { change, percent, direction } from a reference value to a later one. */
export function changeBetween(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) {
    return { change: null, percent: null, direction: 'flat' };
  }
  const change = to - from;
  const percent = (change / from) * 100;
  return { change, percent, direction: directionOfPercent(percent) };
}

/**
 * Currency to show a price in: none for indices (like the exchanges), otherwise the ISO
 * code. Minor units such as 'GBp' (pence) are shown as plain numbers rather than mislabelled.
 */
export function priceCurrency(symbol, currency) {
  if (typeof symbol !== 'string' || symbol.startsWith('^')) return null;
  return typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : null;
}

export const formatPercent = (percent) => `${percentFormat.format(Math.abs(percent))}%`;

/** "+0.86%" / "−1.20%" / "0.00%". */
export function formatSignedPercent(percent) {
  if (!Number.isFinite(percent)) return '—';
  if (directionOfPercent(percent) === 'flat') return formatPercent(percent);
  return `${percent > 0 ? '+' : '−'}${formatPercent(percent)}`;
}

/** "▲ +195.25 (0.86%)". */
export function formatDayChange(change, percent) {
  if (!Number.isFinite(change) || !Number.isFinite(percent)) return '—';
  const direction = directionOfPercent(percent);
  const arrow = direction === 'up' ? '▲ ' : direction === 'down' ? '▼ ' : '';
  return `${arrow}${formatChange(change)} (${formatPercent(percent)})`;
}

/** Screen-reader wording: "up 0.86%", "down 1.20%", "unchanged". */
export function speakChange(percent) {
  if (!Number.isFinite(percent)) return 'change unavailable';
  const direction = directionOfPercent(percent);
  return direction === 'flat' ? 'unchanged' : `${direction} ${formatPercent(percent)}`;
}

/** Indian compact volume: "25.4L", "1.2Cr". */
export const formatVolume = (volume) => formatPrice(volume, { currency: null, compact: true });

/** "3:30 PM IST", or "14 Oct, 3:30 PM IST" when it isn't today in that time zone. */
export function formatMarketTime(tSec, timeZone, nowMs) {
  if (!Number.isFinite(tSec)) return '';
  const zone = resolveTimeZone(timeZone);
  const then = zonedParts(tSec, zone);
  const today = zonedParts(nowMs / 1000, zone);
  const sameDay = then.year === today.year && then.month === today.month && then.day === today.day;
  const options = sameDay
    ? { hour: 'numeric', minute: '2-digit' }
    : { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' };
  const zoneName = zoneAbbreviation(tSec, zone);
  return `${formatInZone(tSec, zone, options)}${zoneName ? ` ${zoneName}` : ''}`;
}

/** Exchange for a symbol before its chart (which carries the real one) has loaded. */
export function guessExchange(symbol) {
  if (isMetal(symbol)) return 'COMEX (converted)';
  if (symbol === '^BSESN' || /\.BO$/.test(symbol)) return 'BSE';
  if (symbol.startsWith('^') || /\.NS$/.test(symbol)) return 'NSE';
  return '';
}

/** What metal prices are quoted in: INR per gram of 24K gold / fine silver. */
export function metalUnit(symbol) {
  if (symbol === 'GOLD') return 'per gram · 24K';
  if (symbol === 'SILVER') return 'per gram · 999 fine';
  return '';
}

export function errorMessage(err) {
  if (err instanceof MarketError || err?.name === 'MarketError') return err.message;
  return 'Couldn’t load market data. Please try again.';
}
