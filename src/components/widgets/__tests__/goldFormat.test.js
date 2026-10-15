import { describe, expect, it } from 'vitest';
import {
  chartScale,
  chartTitle,
  describeChange,
  describeMetal,
  describeSource,
  describeUpdated,
  fitFontSize,
  formatDuty,
  formatRelative,
  intradayChart,
  normalizeMetalPrefs,
  parseDuty,
} from '../goldFormat.js';

// Date / time text follows the runtime locale, so expectations use the same formats.
const clock = (date) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
const day = (date) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);

const RETAIL = { mode: 'retail', dutyPct: 6, purity: '24K' };
const GOLD = { price: 10000, previousClose: 9876.54, changePercent: 1.25, direction: 'up', points: [] };
const SILVER = { price: 170, previousClose: 171.37, changePercent: -0.8, direction: 'down', points: [] };

describe('prefs', () => {
  it('normalizes event prefs like getMetalPrefs()', () => {
    expect(normalizeMetalPrefs(undefined)).toEqual({ mode: 'retail', dutyPct: 6, purity: '24K' });
    expect(normalizeMetalPrefs({ mode: 'spot', dutyPct: '7.5', purity: '22K' })).toEqual({ mode: 'spot', dutyPct: 7.5, purity: '22K' });
    expect(normalizeMetalPrefs({ mode: 'gold', dutyPct: 70, purity: '14K' })).toEqual({ mode: 'retail', dutyPct: 6, purity: '24K' });
    expect(normalizeMetalPrefs({ dutyPct: -1 }).dutyPct).toBe(6);
    expect(normalizeMetalPrefs({ dutyPct: 0 }).dutyPct).toBe(0);
  });

  it('parses the import duty field (0–50, up to 2 decimals)', () => {
    expect(parseDuty('6')).toBe(6);
    expect(parseDuty(' 7.5 ')).toBe(7.5);
    expect(parseDuty('7,5')).toBe(7.5);
    expect(parseDuty('7.')).toBe(7);
    expect(parseDuty('.5')).toBe(0.5);
    expect(parseDuty('0')).toBe(0);
    expect(parseDuty('50')).toBe(50);
    for (const text of ['', '  ', 'abc', '51', '50.01', '-1', '7.555', '1e1', '6%', null, undefined]) {
      expect(parseDuty(text)).toBeNull();
    }
  });

  it('formats duty without trailing zeros', () => {
    expect(formatDuty(6)).toBe('6');
    expect(formatDuty(7.5)).toBe('7.5');
    expect(formatDuty(12.25)).toBe('12.25');
    expect(formatDuty(0)).toBe('0');
  });
});

describe('describeMetal', () => {
  it('shows gold per gram without paise on the tile, with retail duty + GST', () => {
    const gold = describeMetal('GOLD', GOLD, RETAIL);
    expect(gold.label).toBe('Gold 24K');
    expect(gold.headline).toMatchObject({ text: '₹10,918', unit: '/g' }); // 10000 × 1.06 × 1.03
    expect(gold.summary).toBe('Gold 24K, ₹10,918 per gram, retail estimate, up 1.25% today');
    expect(gold.rows).toEqual([
      { id: 'gram', label: 'Per gram (24K)', text: '₹10,918.00' },
      { id: 'sovereign', label: 'Sovereign · 8 g 22K', text: '₹80,065' }, // 8 g × 22/24 × retail
    ]);
  });

  it('applies the purity and the spot mode', () => {
    const gold = describeMetal('GOLD', GOLD, { mode: 'spot', dutyPct: 6, purity: '22K' });
    expect(gold.label).toBe('Gold 22K');
    expect(gold.headline.text).toBe('₹9,167');
    expect(gold.summary).toBe('Gold 22K, ₹9,167 per gram, international price, up 1.25% today');
    expect(gold.rows.map((row) => [row.label, row.text])).toEqual([
      ['Per gram (22K)', '₹9,166.67'],
      ['Sovereign · 8 g 22K', '₹73,333'],
    ]);
  });

  it('shows silver per kg in lakhs and ignores purity', () => {
    const silver = describeMetal('SILVER', SILVER, { ...RETAIL, purity: '18K' });
    expect(silver.label).toBe('Silver');
    expect(silver.headline).toMatchObject({ text: '₹1.86L', unit: '/kg' }); // 170 × 1000 × 1.0918
    expect(silver.summary).toBe('Silver, ₹1,85,606 per kilogram, retail estimate, down 0.80% today');
    expect(silver.rows).toEqual([
      { id: 'gram', label: 'Per gram', text: '₹185.61' },
      { id: 'kg', label: 'Per kg', text: '₹1,85,606' },
    ]);
  });

  it('copes with missing prices and missing change (daily spot)', () => {
    const missing = describeMetal('GOLD', { price: null }, RETAIL);
    expect(missing.headline).toMatchObject({ text: '—', unit: '' });
    expect(missing.summary).toBe('Gold 24K, price unavailable');
    const daily = describeMetal('SILVER', { price: 170, changePercent: null, direction: 'flat' }, { ...RETAIL, mode: 'spot' });
    expect(daily.change).toBeNull();
    expect(daily.summary).toBe('Silver, ₹1,70,000 per kilogram, international price');
  });
});

describe('describeChange', () => {
  it('returns pill text and a spoken form', () => {
    expect(describeChange({ changePercent: 1.25, direction: 'up' })).toEqual({ text: '▲ 1.25%', direction: 'up', spoken: 'up 1.25% today' });
    expect(describeChange({ changePercent: -0.8, direction: 'down' })).toMatchObject({ text: '▼ 0.80%', spoken: 'down 0.80% today' });
    expect(describeChange({ changePercent: 0.001, direction: 'flat' })).toMatchObject({ text: '0.00%', direction: 'flat', spoken: 'unchanged today' });
    expect(describeChange({ changePercent: null })).toBeNull();
    expect(describeChange(undefined)).toBeNull();
  });
});

describe('chart', () => {
  it('builds the intraday series with the previous close as baseline', () => {
    const chart = intradayChart({ points: [[100, 10], [200, 12], [300, 11]], previousClose: 9 });
    expect(chart).toEqual({ values: [10, 12, 11], baseline: 9, high: 12, low: 10, start: 100000, end: 300000 });
    expect(intradayChart({ points: [[100, 10], [200, 11]] }).baseline).toBeNull();
    expect(intradayChart({ points: [[100, 10], null, [200, NaN], [300, 12]] }).values).toEqual([10, 12]);
    expect(intradayChart({ points: [[100, 10]], previousClose: 9 })).toBeNull();
    expect(intradayChart({ points: [] })).toBeNull();
    expect(intradayChart(undefined)).toBeNull();
  });

  it('labels high / low per gram in the current prefs', () => {
    const chart = { high: 12000, low: 11000.4 };
    expect(chartScale('GOLD', chart, { mode: 'spot', dutyPct: 6, purity: '24K' })).toEqual({ high: '₹12,000', low: '₹11,000' });
    expect(chartScale('SILVER', { high: 171, low: 170 }, RETAIL)).toEqual({ high: '₹186.70', low: '₹185.61' });
  });

  it('titles today\'s session "Today" and older ones by date', () => {
    const now = new Date(2026, 9, 15, 10, 0).getTime();
    expect(chartTitle(new Date(2026, 9, 15, 9, 30).getTime(), now)).toBe('Today');
    const friday = new Date(2026, 9, 9, 22, 0);
    expect(chartTitle(friday.getTime(), now)).toBe(day(friday));
  });
});

describe('time and source', () => {
  const now = new Date(2026, 9, 15, 11, 0).getTime();

  it('formats relative times like the currency card', () => {
    expect(formatRelative(now - 30 * 1000, now)).toBe('just now');
    expect(formatRelative(now + 5000, now)).toBe('just now');
    expect(formatRelative(now - 2 * 60 * 1000, now)).toBe('2 minutes ago');
    expect(formatRelative(now - 3 * 60 * 60 * 1000, now)).toBe('3 hours ago');
    expect(formatRelative(now - 2 * 24 * 60 * 60 * 1000, now)).toBe('2 days ago');
  });

  it('describes fresh and offline updates', () => {
    expect(describeUpdated(now - 2 * 60 * 1000, false, now)).toEqual({ full: 'Updated 2 minutes ago', short: 'Updated 2 minutes ago' });
    const earlier = new Date(2026, 9, 15, 9, 5);
    expect(describeUpdated(earlier.getTime(), true, now)).toEqual({
      full: `Offline · last updated ${clock(earlier)}`,
      short: `Offline · ${clock(earlier)}`,
    });
    const yesterday = new Date(2026, 9, 14, 15, 5);
    expect(describeUpdated(yesterday.getTime(), true, now).short).toBe(`Offline · ${day(yesterday)}, ${clock(yesterday)}`);
    expect(describeUpdated(undefined, false, now)).toEqual({ full: '', short: '' });
  });

  it('labels the price source', () => {
    expect(describeSource('comex')).toBe('International (COMEX)');
    expect(describeSource('daily-spot', '2026-10-14')).toBe(`Daily spot · ${day(new Date(2026, 9, 14))}`);
    expect(describeSource('daily-spot')).toBe('Daily spot');
  });
});

describe('fitFontSize', () => {
  it('keeps the tile value inside the card', () => {
    expect(fitFontSize('₹13,881', 26, 110)).toBe(26);
    expect(fitFontSize('₹1,13,881', 26, 110)).toBe(20);
    expect(fitFontSize('x'.repeat(40), 26, 110)).toBe(13);
  });
});
