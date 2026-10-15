import { afterEach, describe, expect, it, vi } from 'vitest';

// Real constants and helpers; only the network-facing calls are replaced.
vi.mock('../../libs/markets/marketService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getQuotes: vi.fn(), getMetalQuotes: vi.fn(), searchSymbols: vi.fn() };
});

import { MarketError, getMetalQuotes, getQuotes, searchSymbols } from '../../libs/markets/marketService.js';
import { loadMarketAnswer } from '../hooks/useMarketAnswer.js';

const signal = new AbortController().signal;
const quote = (symbol, extra = {}) => ({ symbol, name: symbol, price: 100, previousClose: 99, points: [], ...extra });

afterEach(() => {
  vi.resetAllMocks();
});

describe('loadMarketAnswer', () => {
  it('quotes an index directly', async () => {
    getQuotes.mockResolvedValue({ '^NSEI': quote('^NSEI', { name: 'NIFTY 50' }) });
    const data = await loadMarketAnswer({ op: 'quote', symbol: '^NSEI' }, { signal });
    expect(getQuotes).toHaveBeenCalledWith(['^NSEI'], { signal });
    expect(data).toEqual({ quote: expect.objectContaining({ symbol: '^NSEI', name: 'NIFTY 50' }), exchange: 'INDEX' });
    expect(searchSymbols).not.toHaveBeenCalled();
  });

  it('quotes a typed ticker and labels its exchange', async () => {
    getQuotes.mockResolvedValue({ 'TCS.BO': quote('TCS.BO') });
    const data = await loadMarketAnswer({ op: 'quote', symbol: 'TCS.BO' }, { signal });
    expect(data.exchange).toBe('BSE');
  });

  it('uses getMetalQuotes for gold and silver (with its daily-spot fallback)', async () => {
    const silver = quote('SILVER', { source: 'daily-spot', date: '2026-10-15' });
    getMetalQuotes.mockResolvedValue({ GOLD: quote('GOLD'), SILVER: silver, source: 'daily-spot', stale: false });
    const data = await loadMarketAnswer({ op: 'metal', symbol: 'SILVER' }, { signal });
    expect(getMetalQuotes).toHaveBeenCalledWith({ signal });
    expect(data).toEqual({ quote: silver, exchange: 'SILVER' });
    expect(getQuotes).not.toHaveBeenCalled();
  });

  it('resolves a stock name to its NSE/BSE listing and quotes it with the listing name', async () => {
    searchSymbols.mockResolvedValue([
      { symbol: 'RELI', name: 'Reliance Global Group', exchange: 'NASDAQ', type: 'EQUITY' },
      { symbol: 'RELIANCE.NS', name: 'Reliance Industries Limited', exchange: 'NSE', type: 'EQUITY' },
    ]);
    getQuotes.mockResolvedValue({ 'RELIANCE.NS': quote('RELIANCE.NS', { name: 'Reliance Industries Limited' }) });
    const data = await loadMarketAnswer({ op: 'search', query: 'reliance', loose: false }, { signal });
    expect(searchSymbols).toHaveBeenCalledWith('reliance', { signal });
    expect(getQuotes).toHaveBeenCalledWith(['RELIANCE.NS'], { signal, names: { 'RELIANCE.NS': 'Reliance Industries Limited' } });
    expect(data.exchange).toBe('NSE');
    expect(data.quote.name).toBe('Reliance Industries Limited');
  });

  it('falls back to the first result when nothing is listed in India', async () => {
    searchSymbols.mockResolvedValue([{ symbol: 'GOOGL', name: 'Alphabet Inc.', exchange: 'NASDAQ', type: 'EQUITY' }]);
    getQuotes.mockResolvedValue({ GOOGL: quote('GOOGL', { name: 'Alphabet Inc.' }) });
    const data = await loadMarketAnswer({ op: 'search', query: 'alphabet', loose: false }, { signal });
    expect(data.exchange).toBe('NASDAQ');
  });

  it('reports notFound (no card) when a stock name matches nothing', async () => {
    searchSymbols.mockResolvedValue([]);
    expect(await loadMarketAnswer({ op: 'search', query: 'qwertyuiop', loose: false }, { signal })).toEqual({ notFound: true });
    expect(getQuotes).not.toHaveBeenCalled();
  });

  it('reports notFound for a loose query whose results do not match the name', async () => {
    searchSymbols.mockResolvedValue([{ symbol: 'PETRONET.NS', name: 'Petronet LNG Limited', exchange: 'NSE', type: 'EQUITY' }]);
    expect(await loadMarketAnswer({ op: 'search', query: 'petrol', loose: true }, { signal })).toEqual({ notFound: true });
    expect(getQuotes).not.toHaveBeenCalled();
  });

  it('reports notFound when the matched listing has no quote', async () => {
    searchSymbols.mockResolvedValue([{ symbol: 'OLDCO.NS', name: 'Old Co', exchange: 'NSE', type: 'EQUITY' }]);
    getQuotes.mockRejectedValue(new MarketError('NOT_FOUND', 'No market data for these symbols.'));
    expect(await loadMarketAnswer({ op: 'search', query: 'old co', loose: false }, { signal })).toEqual({ notFound: true });
  });

  it('routes a name that resolves to gold or silver through the metal quotes', async () => {
    searchSymbols.mockResolvedValue([{ symbol: 'GOLD', name: 'Gold', exchange: 'Metals', type: 'METAL' }]);
    getMetalQuotes.mockResolvedValue({ GOLD: quote('GOLD'), SILVER: quote('SILVER'), source: 'comex', stale: false });
    const data = await loadMarketAnswer({ op: 'search', query: 'gold', loose: false }, { signal });
    expect(data.exchange).toBe('GOLD');
    expect(getQuotes).not.toHaveBeenCalled();
  });

  it('surfaces real failures as errors', async () => {
    searchSymbols.mockRejectedValue(new MarketError('OFFLINE', 'You’re offline.'));
    await expect(loadMarketAnswer({ op: 'search', query: 'tcs', loose: false }, { signal })).rejects.toThrow('You’re offline.');

    getQuotes.mockRejectedValue(new MarketError('NOT_FOUND', 'Symbol not found.'));
    await expect(loadMarketAnswer({ op: 'quote', symbol: 'NOPE.NS' }, { signal })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
