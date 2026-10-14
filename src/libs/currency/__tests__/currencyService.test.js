import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  convert,
  getLatestRates,
  getRateHistory,
  parseConversionQuery,
  resolveCurrency,
} from '../currencyService.js';

let store;
let fetchMock;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);

function latest(base, rates) {
  return {
    result: 'success',
    base_code: base,
    time_last_update_unix: NOW / 1000 - 3600,
    time_next_update_unix: NOW / 1000 + 20 * 3600,
    rates: { [base]: 1, ...rates },
  };
}

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseConversionQuery', () => {
  it.each([
    ['100 usd to inr', { amount: 100, from: 'USD', to: 'INR' }],
    ['100usd in inr', { amount: 100, from: 'USD', to: 'INR' }],
    ['$50 to rupees', { amount: 50, from: 'USD', to: 'INR' }],
    ['₹1,500 in dollars', { amount: 1500, from: 'INR', to: 'USD' }],
    ['1.5k eur → gbp', { amount: 1500, from: 'EUR', to: 'GBP' }],
    ['2 lakh inr to aed', { amount: 200000, from: 'INR', to: 'AED' }],
    ['usd to inr', { amount: 1, from: 'USD', to: 'INR' }],
    ['10 US Dollars into Euros', { amount: 10, from: 'USD', to: 'EUR' }],
    ['250 dirhams to rupees', { amount: 250, from: 'AED', to: 'INR' }],
  ])('parses %j', (query, expected) => {
    expect(parseConversionQuery(query, { defaultTo: 'INR' })).toEqual(expected);
  });

  it('uses the saved target currency when none is given', () => {
    expect(parseConversionQuery('100 eur', { defaultTo: 'INR' })).toEqual({ amount: 100, from: 'EUR', to: 'INR' });
    expect(parseConversionQuery('$20', { defaultTo: 'INR' })).toEqual({ amount: 20, from: 'USD', to: 'INR' });
    // Same as target → pick a sensible counterpart.
    expect(parseConversionQuery('500 inr', { defaultTo: 'INR' })).toEqual({ amount: 500, from: 'INR', to: 'USD' });
  });

  it.each(['how to cook rice', '100 m to km', 'weather in chennai', '100', 'react hooks', '', 'to inr'])(
    'ignores non-currency query %j',
    (query) => {
      expect(parseConversionQuery(query, { defaultTo: 'INR' })).toBeNull();
    },
  );

  it('resolves symbols, codes and names', () => {
    expect(resolveCurrency('€')).toBe('EUR');
    expect(resolveCurrency('sgd')).toBe('SGD');
    expect(resolveCurrency('Rupees')).toBe('INR');
    expect(resolveCurrency('xyz')).toBeNull();
  });
});

describe('rates', () => {
  it('converts using the latest rates and caches them until the next update', async () => {
    fetchMock.mockResolvedValue(jsonResponse(latest('USD', { INR: 83.5, EUR: 0.92 })));
    const first = await convert(100, 'USD', 'INR', { now: NOW });
    expect(first.result).toBeCloseTo(8350);
    expect(first.rate).toBe(83.5);
    await convert(10, 'USD', 'EUR', { now: NOW + 60_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves stale cached rates when the network fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(latest('USD', { INR: 83.5 })));
    await getLatestRates('USD', { now: NOW });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const later = await getLatestRates('USD', { now: NOW + 2 * 24 * 3600 * 1000 });
    expect(later.stale).toBe(true);
    expect(later.rates.INR).toBe(83.5);
  });

  it('reports a network error when nothing is cached', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(getLatestRates('USD', { now: NOW })).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('rejects malformed responses and unsupported currencies', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ result: 'error' }));
    await expect(getLatestRates('USD', { now: NOW })).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    await expect(getLatestRates('XYZ', { now: NOW })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });

  it('returns 1:1 for the same currency without a request', async () => {
    const res = await convert(42, 'INR', 'INR');
    expect(res.result).toBe(42);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects invalid amounts', async () => {
    await expect(convert('abc', 'USD', 'INR')).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });
});

describe('history', () => {
  it('returns sorted daily points and caches them for the day', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      base: 'USD',
      rates: { '2026-10-13': { INR: 83.6 }, '2026-10-09': { INR: 83.1 }, '2026-10-12': { INR: 83.4 } },
    }));
    const points = await getRateHistory('USD', 'INR', { now: NOW });
    expect(points.map((p) => p.date)).toEqual(['2026-10-09', '2026-10-12', '2026-10-13']);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('base=USD');
    expect(url).toContain('symbols=INR');
    await getRateHistory('USD', 'INR', { now: NOW + 1000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null for pairs the history source does not cover', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'not found' }, 404));
    expect(await getRateHistory('AED', 'INR', { now: NOW })).toBeNull();
  });
});
