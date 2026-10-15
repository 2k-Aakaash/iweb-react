import { afterEach, describe, expect, it, vi } from 'vitest';

// Real currency parser, wrapped so one test can force a "conversion" match.
vi.mock('../../libs/currency/currencyService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, parseConversionQuery: vi.fn(actual.parseConversionQuery) };
});

import { parseConversionQuery } from '../../libs/currency/currencyService.js';
import { parseMarketQuery, pickSearchResult } from '../utils/marketQuery.js';

afterEach(() => {
  vi.clearAllMocks();
});

describe('parseMarketQuery: indices', () => {
  it.each([
    ['nifty', '^NSEI'],
    ['Nifty 50', '^NSEI'],
    ['nifty50', '^NSEI'],
    ['NIFTY 50 index', '^NSEI'],
    ['nifty today', '^NSEI'],
    ["today's nifty", '^NSEI'],
    ['nifty live', '^NSEI'],
    ['nifty now', '^NSEI'],
    ['nifty price', '^NSEI'],
    ['nifty level', '^NSEI'],
    ['  nifty   50   live  ', '^NSEI'],
    ['nifty?', '^NSEI'],
    ['sensex', '^BSESN'],
    ['Sensex today', '^BSESN'],
    ['bse sensex live', '^BSESN'],
    ['bank nifty', '^NSEBANK'],
    ['banknifty', '^NSEBANK'],
    ['nifty bank', '^NSEBANK'],
    ['bank nifty index today', '^NSEBANK'],
    ['nifty it', '^CNXIT'],
    ['nifty it index', '^CNXIT'],
    ['india vix', '^INDIAVIX'],
    ['vix', '^INDIAVIX'],
    ['VIX today', '^INDIAVIX'],
    // An index named in a stock phrase is still the index
    ['nifty share price', '^NSEI'],
    ['sensex stock', '^BSESN'],
  ])('%j → %s', (query, symbol) => {
    expect(parseMarketQuery(query)).toEqual({ kind: 'index', symbol });
  });
});

describe('parseMarketQuery: gold and silver', () => {
  it.each([
    ['gold', {}],
    ['Gold rate', {}],
    ['gold price', {}],
    ['gold rate today', {}],
    ["today's gold rate", {}],
    ['gold price per gram', {}],
    ['1 gram gold rate', {}],
    ['22k gold', { purity: '22K' }],
    ['gold 22 carat', { purity: '22K' }],
    ['22 karat gold', { purity: '22K' }],
    ['24 carat gold price today', { purity: '24K' }],
    ['18kt gold rate', { purity: '18K' }],
    ['916 gold rate', { purity: '22K' }],
    ['22k rate', { purity: '22K' }],
    ['sovereign rate', { sovereign: true }],
    ['pavan rate', { sovereign: true }],
    ['1 sovereign gold', { sovereign: true }],
    ['1 sovereign', { sovereign: true }],
    ['sovereign gold rate today', { sovereign: true }],
    ['22k sovereign price', { purity: '22K', sovereign: true }],
  ])('%j → GOLD %j', (query, extra) => {
    expect(parseMarketQuery(query)).toEqual({ kind: 'metal', symbol: 'GOLD', ...extra });
  });

  it.each(['silver', 'silver rate', 'silver price today', 'Silver Rate Today', '1 kg silver price'])('%j → SILVER', (query) => {
    expect(parseMarketQuery(query)).toEqual({ kind: 'metal', symbol: 'SILVER' });
  });
});

describe('parseMarketQuery: stocks', () => {
  it.each([
    ['reliance share price', 'reliance'],
    ['Reliance Stock Price', 'reliance'],
    ['tata motors share price today', 'tata motors'],
    ['hdfc bank stock price live', 'hdfc bank'],
    ["dr. reddy's share price", "dr. reddy's"],
    ['l&t share price', 'l&t'],
    ['ab share price', 'ab'],
  ])('%j → name %j', (query, name) => {
    expect(parseMarketQuery(query)).toEqual({ kind: 'stock', query: name });
  });

  // One-word forms also appear in everyday searches, so they are marked loose.
  it.each([
    ['tcs shares', 'tcs'],
    ['infosys share', 'infosys'],
    ['wipro stock', 'wipro'],
    ['reliance price', 'reliance'],
    ['reliance price today', 'reliance'],
  ])('%j → loose name %j', (query, name) => {
    expect(parseMarketQuery(query)).toEqual({ kind: 'stock', query: name, loose: true });
  });

  it.each([
    ['RELIANCE.NS', 'RELIANCE.NS'],
    ['tcs.bo', 'TCS.BO'],
    ['m&m.ns', 'M&M.NS'],
    ['bajaj-auto.ns', 'BAJAJ-AUTO.NS'],
    ['infy.ns share price', 'INFY.NS'],
  ])('%j → ticker %s', (query, symbol) => {
    expect(parseMarketQuery(query)).toEqual({ kind: 'stock', symbol });
  });

  it('accepts names of 2–40 characters only', () => {
    expect(parseMarketQuery(`${'a'.repeat(40)} share price`)).toEqual({ kind: 'stock', query: 'a'.repeat(40) });
    expect(parseMarketQuery(`${'a'.repeat(41)} stock`)).toBeNull();
    expect(parseMarketQuery('x share price')).toBeNull();
  });
});

describe('parseMarketQuery: everything else', () => {
  it.each([
    '',
    '   ',
    // Generic phrases
    'gold ring designs',
    'nifty fifty definition',
    'stock market basics',
    'price of iphone',
    'what is nifty',
    'is nifty up today',
    'nifty 50 stocks list',
    'stock market today',
    'reliance',
    'tcs',
    'reliance.nse',
    // Stock words without a company
    'price',
    'stock',
    'shares',
    'share price',
    'stock price',
    'what is share price',
    'how to check share price',
    'how to buy stock',
    'is it a good stock',
    'penny stock',
    'best stock',
    'top shares',
    'indian stock price',
    'in stock',
    'out of stock',
    // Currencies are the currency answer's job
    'dollar price',
    'usd price',
    'euro price today',
    // Not gold questions
    'pavan',
    'pavan kalyan',
    'sovereign',
    '22k',
    '22 carat',
    '14k gold',
    'silver 22k',
    'silver sovereign',
    '24k sovereign rate',
    'gold loan',
    'golden retriever',
    'white gold',
    'gold rate in chennai',
    'silver jubilee',
  ])('%j → null', (query) => {
    expect(parseMarketQuery(query)).toBeNull();
  });

  it.each([null, undefined, 42, {}])('%j (not a string) → null', (query) => {
    expect(parseMarketQuery(query)).toBeNull();
  });

  it('ignores very long queries', () => {
    expect(parseMarketQuery(`nifty ${'today '.repeat(12)}`)).toBeNull();
  });

  it.each(['100 usd to inr', 'usd to inr', '$50 in rupees', '100 eur', '1.5k eur → gbp', '2 lakh inr to aed'])(
    'leaves the currency conversion %j to the currency answer',
    (query) => {
      expect(parseConversionQuery(query)).not.toBeNull();
      expect(parseMarketQuery(query)).toBeNull();
    },
  );

  it('yields to the currency parser whenever it matches', () => {
    parseConversionQuery.mockReturnValueOnce({ amount: 1, from: 'USD', to: 'INR' });
    expect(parseMarketQuery('nifty')).toBeNull();
    expect(parseConversionQuery).toHaveBeenCalledWith('nifty');
    // Without a conversion match the same query is an index.
    expect(parseMarketQuery('nifty')).toEqual({ kind: 'index', symbol: '^NSEI' });
  });
});

describe('pickSearchResult', () => {
  const local = { symbol: '^NSEBANK', name: 'NIFTY BANK', exchange: 'NSE', type: 'INDEX' };
  const us = { symbol: 'HDB', name: 'HDFC Bank Limited', exchange: 'NYSE', type: 'EQUITY' };
  const nse = { symbol: 'HDFCBANK.NS', name: 'HDFC Bank Limited', exchange: 'NSE', type: 'EQUITY' };
  const bse = { symbol: 'HDFCBANK.BO', name: 'HDFC Bank Limited', exchange: 'BSE', type: 'EQUITY' };

  it('takes the first NSE/BSE listing', () => {
    expect(pickSearchResult([local, us, nse, bse], { query: 'hdfc bank' })).toBe(nse);
    expect(pickSearchResult([us, bse, nse], { query: 'hdfc bank' })).toBe(bse);
  });

  it('falls back to the first result', () => {
    const apple = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', type: 'EQUITY' };
    expect(pickSearchResult([apple, us], { query: 'apple' })).toBe(apple);
  });

  it('returns null when there is nothing to pick', () => {
    expect(pickSearchResult([], { query: 'x' })).toBeNull();
    expect(pickSearchResult(null, { query: 'x' })).toBeNull();
    expect(pickSearchResult([{ name: 'No symbol' }], { query: 'x' })).toBeNull();
  });

  it('loose queries need a result whose ticker or name matches', () => {
    const petronet = { symbol: 'PETRONET.NS', name: 'Petronet LNG Limited', exchange: 'NSE', type: 'EQUITY' };
    expect(pickSearchResult([petronet], { query: 'petrol', loose: true })).toBeNull();
    expect(pickSearchResult([petronet], { query: 'petrol' })).toBe(petronet);

    const airtel = { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel Limited', exchange: 'NSE', type: 'EQUITY' };
    const lt = { symbol: 'LT.NS', name: 'Larsen & Toubro Limited', exchange: 'NSE', type: 'EQUITY' };
    const sbi = { symbol: 'SBIN.NS', name: 'State Bank of India', exchange: 'NSE', type: 'EQUITY' };
    expect(pickSearchResult([petronet, airtel], { query: 'airtel', loose: true })).toBe(airtel);
    expect(pickSearchResult([lt], { query: 'l&t', loose: true })).toBe(lt);
    expect(pickSearchResult([sbi], { query: 'sbi', loose: true })).toBe(sbi);
    expect(pickSearchResult([us, nse], { query: 'hdfc bank', loose: true })).toBe(nse);
  });
});

describe('loose matches (regressions)', () => {
  const marathon = { symbol: 'MPC', name: 'Marathon Petroleum Corporation', exchange: 'NYSE' };
  const petronet = { symbol: 'PETRONET.NS', name: 'Petronet LNG Limited', exchange: 'NSE' };

  it('does not quote "petrol price" as Marathon Petroleum or any word-prefix match', () => {
    expect(pickSearchResult([marathon, petronet], { query: 'petrol', loose: true })).toBeNull();
  });

  it('only quotes NSE/BSE listings for one-word phrases', () => {
    const apple = { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' };
    expect(pickSearchResult([apple], { query: 'apple', loose: true })).toBeNull();
    const airtel = { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel Limited', exchange: 'NSE' };
    expect(pickSearchResult([airtel], { query: 'airtel', loose: true })).toBe(airtel);
  });
});
