import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetNotifications,
  clearAll,
  clearApp,
  groupByApp,
  notify,
  notifyOnce,
  removeNotification,
  setQuiet,
  timeAgo,
  useNotifications,
} from '../notifications';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

// What every tab sees: the saved list.
const read = () => JSON.parse(localStorage.getItem('iweb:notifications') || '[]');

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
  setQuiet(() => false);
  _resetNotifications();
});

describe('notifications', () => {
  it('keeps the newest first, saved for every tab', () => {
    notify({ app: 'timer', title: 'Timer', body: 'Done', now: 1000 });
    notify({ app: 'notes', title: 'Tasks', body: '2 due', now: 2000 });
    expect(read().map((n) => n.title)).toEqual(['Tasks', 'Timer']);
  });

  it('replaces one with the same key instead of adding another', () => {
    notify({ app: 'timer', title: 'Timer', body: 'first', key: 'timer' });
    notify({ app: 'timer', title: 'Timer', body: 'second', key: 'timer' });
    expect(read().map((n) => n.body)).toEqual(['second']);
  });

  it('posts a notifyOnce key only the first time', () => {
    expect(notifyOnce('update:v3', { app: 'update', title: 'Software Update' })).not.toBe(null);
    removeNotification(read()[0].id);
    expect(notifyOnce('update:v3', { app: 'update', title: 'Software Update' })).toBe(null);
    expect(read()).toEqual([]);
  });

  it('clears one app, or everything', () => {
    notify({ app: 'timer', title: 'A' });
    notify({ app: 'notes', title: 'B' });
    notify({ app: 'timer', title: 'C' });
    clearApp('timer');
    expect(read().map((n) => n.title)).toEqual(['B']);
    clearAll();
    expect(read()).toEqual([]);
  });

  it('groups by app, newest group first', () => {
    const list = [
      { id: '1', app: 'notes', title: 'n1', time: 3 },
      { id: '2', app: 'timer', title: 't1', time: 2 },
      { id: '3', app: 'notes', title: 'n2', time: 1 },
    ];
    expect(groupByApp(list).map((g) => [g.app, g.items.map((n) => n.title)])).toEqual([['notes', ['n1', 'n2']], ['timer', ['t1']]]);
  });

  it('says how long ago, as macOS does', () => {
    const now = 1_000_000_000;
    expect(timeAgo(now - 10_000, now)).toBe('now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5m ago');
    expect(timeAgo(now - 3 * 3600_000, now)).toBe('3h ago');
    expect(timeAgo(now - 30 * 3600_000, now)).toBe('Yesterday');
  });

  it('exports a hook for components', () => {
    expect(typeof useNotifications).toBe('function');
  });
});
