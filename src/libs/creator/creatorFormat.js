// Number, time and money formatting for the Creator widgets. Unknown values come back as
// null so the UI can say "Unavailable" instead of showing a misleading 0.

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/** 1234567 → "1.2M" (null when unknown). */
export function formatCompact(n) {
  return finite(n) ? compact.format(n) : null;
}

/** 1234567 → "1,234,567" (null when unknown). */
export function formatFull(n) {
  return finite(n) ? full.format(n) : null;
}

/** A change with its sign: "+1.2K", "−340", "0". */
export function formatDelta(n) {
  if (!finite(n)) return null;
  if (n === 0) return '0';
  return `${n > 0 ? '+' : '−'}${compact.format(Math.abs(n))}`;
}

/** Seconds as "m:ss" or "h:mm:ss". */
export function formatDuration(seconds) {
  if (!finite(seconds) || seconds < 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Watch time in minutes as hours: "12.3K hrs". */
export function formatWatchHours(minutes) {
  return finite(minutes) ? `${compact.format(minutes / 60)} hrs` : null;
}

/** An amount in an ISO 4217 currency, compact for large amounts: "₹12.3K", "$842.10". */
export function formatMoney(amount, currency) {
  if (!finite(amount) || !/^[A-Z]{3}$/.test(currency || '')) return null;
  try {
    const big = Math.abs(amount) >= 10000;
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      ...(big ? { notation: 'compact', maximumFractionDigits: 1 } : { maximumFractionDigits: 2 }),
    }).format(amount);
  } catch {
    return null;
  }
}

/** "Just now", "5 min ago", "3 hr ago", "2 days ago". */
export function formatAgo(at, now = Date.now()) {
  if (!finite(at)) return null;
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'Just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** A day (YYYY-MM-DD, as the APIs report periods) as "4 Oct". */
export function formatDay(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || '');
  if (!match) return null;
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** A timestamp as "4 Oct". */
export function formatDate(at) {
  return finite(at) ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : null;
}
