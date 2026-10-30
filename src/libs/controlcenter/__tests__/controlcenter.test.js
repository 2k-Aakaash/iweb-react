import { beforeEach, describe, expect, it } from 'vitest';
import { CONTROLS, DEFAULT_CONTROLS, hiddenControls, moveControl, normalizeControls } from '../controls.js';
import { actionForKey, calculate, clearLabel, formatNumber, initialCalc } from '../calculator.js';
import {
  cancelTimer, finishTimer, formatRemaining, getTimer, isActive, isRunning, normalizeTimer, pauseTimer, remainingAt,
  resumeTimer, startTimer,
} from '../timer.js';
import { dimFor, normalizeBrightness } from '../ccPrefs.js';
import { connectionSummary, speedLabel } from '../connection.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(String(k)) ? this.map.get(String(k)) : null; }
  setItem(k, v) { this.map.set(String(k), String(v)); }
  removeItem(k) { this.map.delete(String(k)); }
  clear() { this.map.clear(); }
}
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });

describe('controls', () => {
  it('keeps known controls, each once, in order', () => {
    expect(normalizeControls(['sound', 'bluetooth', 'sound', 'focus'])).toEqual(['sound', 'focus']);
    expect(normalizeControls('focus')).toBeNull();
    expect(normalizeControls(DEFAULT_CONTROLS)).toEqual([...DEFAULT_CONTROLS]);
    expect(DEFAULT_CONTROLS.every((id) => CONTROLS[id])).toBe(true);
  });

  it('offers the controls that are not shown', () => {
    expect(hiddenControls(DEFAULT_CONTROLS)).toEqual(['fullscreen']);
    expect(hiddenControls([])).toHaveLength(Object.keys(CONTROLS).length);
  });

  it('moves a control before another, or to the end', () => {
    const list = ['a', 'b', 'c', 'd'];
    expect(moveControl(list, 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(moveControl(list, 'a', 'c')).toEqual(['b', 'a', 'c', 'd']);
    expect(moveControl(list, 'b', null)).toEqual(['a', 'c', 'd', 'b']);
    expect(moveControl(list, 'b', 'b')).toBe(list);
    expect(moveControl(list, 'z', 'a')).toBe(list);
  });
});

describe('calculator', () => {
  const press = (keys) => keys.split(' ').reduce((s, key) => {
    if (/^[0-9]$/.test(key)) return calculate(s, { type: 'digit', digit: key });
    const named = { '.': { type: 'dot' }, '=': { type: 'equals' }, C: { type: 'clear' }, '±': { type: 'sign' }, '%': { type: 'percent' }, '⌫': { type: 'backspace' } };
    return calculate(s, named[key] || { type: 'op', op: key });
  }, initialCalc);

  it('works left to right, like a basic calculator', () => {
    expect(press('2 + 3 × 4 =').display).toBe('20');
    expect(press('1 2 . 5 ÷ 5 =').display).toBe('2.5');
    expect(press('9 − 1 2 =').display).toBe('-3');
    // Shows the running total when the next operator is pressed.
    expect(press('2 + 3 ×').display).toBe('5');
  });

  it('repeats the last operation on =, replaces a doubled operator', () => {
    expect(press('2 + 3 = =').display).toBe('8');
    expect(press('6 + × 2 =').display).toBe('12');
  });

  it('handles signs, percent, decimals, deleting and clearing', () => {
    expect(press('5 ±').display).toBe('-5');
    expect(press('5 0 %').display).toBe('0.5');
    expect(press('. 5 + . 2 5 =').display).toBe('0.75');
    expect(press('1 2 3 ⌫').display).toBe('12');
    const entry = press('7 + 8');
    expect(clearLabel(entry)).toBe('C');
    const cleared = calculate(entry, { type: 'clear' });
    expect(cleared.display).toBe('0');
    expect(calculate(cleared, { type: 'digit', digit: '1' }).op).toBe('+'); // C keeps 7 +
    expect(calculate(cleared, { type: 'clear' })).toEqual(initialCalc); // AC clears it
  });

  it('shows an error for division by zero, then starts over', () => {
    const err = press('4 ÷ 0 =');
    expect(err.display).toBe('Error');
    expect(calculate(err, { type: 'digit', digit: '3' }).display).toBe('3');
  });

  it('rounds and shortens long results', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatNumber(1 / 3)).toBe('0.333333333333');
    expect(formatNumber(123456789 * 987654321)).toBe('1.219326e17');
    expect(press('1 2 3 4 5 6 7 8 9 0 1 2 3').display).toBe('123456789012');
  });

  it('reads the keyboard', () => {
    expect(actionForKey('7')).toEqual({ type: 'digit', digit: '7' });
    expect(actionForKey('*')).toEqual({ type: 'op', op: '×' });
    expect(actionForKey('Enter')).toEqual({ type: 'equals' });
    expect(actionForKey('Escape')).toBeNull();
  });
});

describe('timer', () => {
  beforeEach(() => cancelTimer());

  it('counts down, pauses, resumes and ends', () => {
    startTimer(60_000, 1000);
    expect(isRunning(getTimer())).toBe(true);
    expect(remainingAt(getTimer(), 31_000)).toBe(30_000);
    pauseTimer(31_000);
    expect(isRunning(getTimer())).toBe(false);
    expect(remainingAt(getTimer(), 99_000)).toBe(30_000);
    resumeTimer(50_000);
    expect(remainingAt(getTimer(), 70_000)).toBe(10_000);
    expect(finishTimer()).toBe(true);
    expect(finishTimer()).toBe(false); // already ended (another tab won't ring again)
    expect(getTimer().done).toBe(true);
    cancelTimer();
    expect(isActive(getTimer())).toBe(false);
  });

  it('is shared through localStorage, and ignores broken values', () => {
    startTimer(5 * 60_000, 0);
    expect(normalizeTimer(JSON.parse(localStorage.getItem('iweb:timer')))).toEqual(getTimer());
    expect(normalizeTimer({ duration: -1 })).toEqual(normalizeTimer(null));
    expect(normalizeTimer({ duration: 5, endsAt: 'soon' }).duration).toBe(0);
  });

  it('formats what is left', () => {
    expect(formatRemaining(7_000)).toBe('0:07');
    expect(formatRemaining(249_001)).toBe('4:10');
    expect(formatRemaining(3_909_000)).toBe('1:05:09');
  });
});

describe('display and connection', () => {
  it('keeps the wallpaper brightness in range and veils it', () => {
    expect(normalizeBrightness(150)).toBe(100);
    expect(normalizeBrightness(5)).toBe(20);
    expect(normalizeBrightness('bright')).toBeNull();
    expect(dimFor(100)).toBe(0);
    expect(dimFor(40)).toBe(0.6);
  });

  it('describes the connection', () => {
    const online = { online: true, type: '', effectiveType: '4g' };
    expect(connectionSummary(online)).toBe('Connected');
    expect(connectionSummary({ ...online, type: 'wifi' })).toBe('Wi-Fi');
    expect(connectionSummary({ ...online, online: false })).toBe('Not Connected');
    expect(speedLabel(online)).toBe('Fast');
    expect(speedLabel({ effectiveType: '' })).toBe('Unknown');
  });
});
