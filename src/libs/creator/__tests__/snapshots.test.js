import { describe, expect, it } from 'vitest';
import { MAX_SNAPSHOTS, headlineChange, metricChanges, pruneSnapshots, snapshotOf } from '../snapshots.js';

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 2, 12);
const snap = (at, subscribers) => ({ accountId: 'youtube:UC1', at, metrics: { subscribers } });

describe('snapshotOf', () => {
  it('keeps only lifetime counters, and nothing for hidden counts', () => {
    expect(snapshotOf('a', { platform: 'youtube', fetchedAt: 1, stats: { subscribers: 10, views: 5, videos: 2, subscribersHidden: false } }).metrics)
      .toEqual({ subscribers: 10, views: 5, videos: 2 });
    expect(snapshotOf('a', { platform: 'youtube', fetchedAt: 1, stats: { subscribers: null, subscribersHidden: true, views: 5, videos: 2 } }).metrics.subscribers).toBeNull();
    expect(snapshotOf('b', { platform: 'instagram', fetchedAt: 1, stats: { followers: 7, media: 3 } }).metrics).toEqual({ followers: 7, media: 3 });
    expect(snapshotOf('b', { platform: 'instagram', fetchedAt: 1, stats: {} })).toBeNull();
    expect(snapshotOf('b', null)).toBeNull();
  });
});

describe('pruneSnapshots', () => {
  it('keeps one per hour for two days, then one per day, for 400 days', () => {
    const list = [
      snap(NOW - 10 * 60e3, 3), snap(NOW - 20 * 60e3, 2), // same hour: the later stays
      snap(NOW - 5 * DAY - HOUR, 1), snap(NOW - 5 * DAY - 2 * HOUR, 0), // same day
      snap(NOW - 401 * DAY, 9), // too old
    ];
    const kept = pruneSnapshots(list, NOW);
    expect(kept.map((s) => s.metrics.subscribers)).toEqual([1, 3]);
  });

  it('never keeps more than the cap', () => {
    const many = Array.from({ length: 600 }, (_, i) => snap(NOW - i * DAY * 0.6, i));
    expect(pruneSnapshots(many, NOW).length).toBeLessThanOrEqual(MAX_SNAPSHOTS);
  });
});

describe('metricChanges', () => {
  const current = { metric: 'subscribers', value: 1500, at: NOW };

  it('has nothing to say without history', () => {
    expect(metricChanges([], current, NOW)).toEqual({ previous: null, d7: null, d28: null, tracked: null });
    expect(headlineChange(metricChanges([snap(NOW, 1500)], current, NOW))).toBeNull();
  });

  it('works out each window only from snapshots near its start', () => {
    const list = [snap(NOW - 30 * DAY, 1000), snap(NOW - 7 * DAY + HOUR, 1300), snap(NOW - DAY, 1450), snap(NOW, 1500)];
    const c = metricChanges(list, current, NOW);
    expect(c.previous).toEqual({ delta: 50, since: NOW - DAY });
    expect(c.d7).toEqual({ delta: 200, since: NOW - 7 * DAY + HOUR });
    expect(c.d28).toEqual({ delta: 500, since: NOW - 30 * DAY });
    expect(c.tracked).toEqual({ delta: 500, since: NOW - 30 * DAY });
    expect(headlineChange(c)).toMatchObject({ delta: 200, label: '7d' });
  });

  it('does not stretch a window to a far-off snapshot', () => {
    const c = metricChanges([snap(NOW - 3 * DAY, 1400), snap(NOW, 1500)], current, NOW);
    expect(c.d7).toBeNull();
    expect(c.d28).toBeNull();
    expect(headlineChange(c)).toMatchObject({ delta: 100, label: 'since tracking' });
  });

  it('ignores snapshots without the metric', () => {
    const c = metricChanges([snap(NOW - 7 * DAY, null), snap(NOW, 1500)], current, NOW);
    expect(c.d7).toBeNull();
  });
});
