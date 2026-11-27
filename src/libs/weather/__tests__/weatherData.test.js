import { afterEach, describe, expect, it } from 'vitest';
import { cachedWeather, nowIndex, saveCity, savedCity, updatedLabel } from '../weatherData.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(String(k)) ? this.map.get(String(k)) : null; }
  setItem(k, v) { this.map.set(String(k), String(v)); }
  removeItem(k) { this.map.delete(String(k)); }
  clear() { this.map.clear(); }
}
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });

const at = (iso) => ({ time: iso, data: {} });

describe('nowIndex', () => {
  const series = [at('2026-11-27T10:00:00Z'), at('2026-11-27T11:00:00Z'), at('2026-11-27T12:00:00Z')];
  it('picks the hour that has started', () => {
    expect(nowIndex(series, Date.parse('2026-11-27T09:30:00Z'))).toBe(0);
    expect(nowIndex(series, Date.parse('2026-11-27T11:20:00Z'))).toBe(1);
    expect(nowIndex(series, Date.parse('2026-11-27T15:00:00Z'))).toBe(2);
  });
});

describe('updatedLabel', () => {
  const now = Date.parse('2026-11-27T12:00:00Z');
  it('says how long ago', () => {
    expect(updatedLabel(now - 20 * 1000, now)).toBe('Updated just now');
    expect(updatedLabel(now - 5 * 60 * 1000, now)).toBe('Updated 5 min ago');
    expect(updatedLabel(now - 130 * 60 * 1000, now)).toBe('Updated 2 h ago');
  });
});

describe('saved city', () => {
  afterEach(() => localStorage.clear());
  it('is kept, and forgetting it means following the current location', () => {
    saveCity({ lat: 13.08, lon: 80.27, name: 'Chennai' });
    expect(savedCity()).toEqual({ lat: 13.08, lon: 80.27, name: 'Chennai' });
    saveCity(null);
    expect(savedCity()).toBeNull();
  });
  it('ignores a broken saved value', () => {
    localStorage.setItem('weatherLocation', '{"lat":"x"}');
    expect(savedCity()).toBeNull();
    localStorage.setItem('weatherCache', 'nope');
    expect(cachedWeather()).toBeNull();
  });
});
