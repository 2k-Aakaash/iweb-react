// Growth indicators for the Creator widgets, from snapshots kept on this device.
//
// After each successful refresh the account's lifetime counters (subscribers, total views,
// videos; followers, posts) are saved as a snapshot (creatorDb.js). Changes are worked out
// only from those snapshots: nothing is estimated, and a change is shown only when a
// snapshot exists from close enough to the start of its window. Period metrics the APIs
// report (28-day views, reach…) are never diffed here; they're shown as reported.
//
// Retention (pruneSnapshots), per account:
//   the last 48 hours  — at most one per hour (the latest in each hour)
//   older              — at most one per day (the latest in each UTC day), up to 400 days
//   never more than MAX_SNAPSHOTS in all.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const RECENT_MS = 48 * HOUR;
export const KEEP_DAYS = 400;
export const MAX_SNAPSHOTS = 500;

/** The lifetime counters of an account's latest data, as a snapshot ({ at, metrics }). */
export function snapshotOf(accountId, data) {
  if (!data || !Number.isFinite(data.fetchedAt)) return null;
  const s = data.stats || {};
  const pick = (v) => (Number.isFinite(v) ? v : null);
  const metrics = data.platform === 'instagram'
    ? { followers: pick(s.followers), media: pick(s.media) }
    : { subscribers: s.subscribersHidden ? null : pick(s.subscribers), views: pick(s.views), videos: pick(s.videos) };
  if (Object.values(metrics).every((v) => v === null)) return null;
  return { accountId, platform: data.platform, at: data.fetchedAt, metrics };
}

/** The snapshots to keep (oldest first), by the retention rules above. */
export function pruneSnapshots(list, now = Date.now()) {
  const sorted = [...list].filter((s) => Number.isFinite(s?.at)).sort((a, b) => a.at - b.at);
  const buckets = new Map(); // bucket → latest snapshot in it
  for (const snap of sorted) {
    const age = now - snap.at;
    if (age > KEEP_DAYS * DAY) continue;
    const bucket = age <= RECENT_MS ? `h${Math.floor(snap.at / HOUR)}` : `d${Math.floor(snap.at / DAY)}`;
    buckets.set(bucket, snap); // sorted ascending: the last one written wins
  }
  return [...buckets.values()].sort((a, b) => a.at - b.at).slice(-MAX_SNAPSHOTS);
}

// The snapshot closest to `target` within `tolerance`, among those with the metric.
function nearest(list, metric, target, tolerance) {
  let best = null;
  for (const snap of list) {
    const value = snap.metrics?.[metric];
    if (!Number.isFinite(value)) continue;
    const off = Math.abs(snap.at - target);
    if (off <= tolerance && (!best || off < best.off)) best = { snap, off };
  }
  return best?.snap || null;
}

const change = (current, base) => (base ? { delta: current.value - base.metrics[current.metric], since: base.at } : null);

/**
 * Changes of one counter, each { delta, since } or null when there isn't enough history:
 *   previous — since the snapshot before this one
 *   d7, d28  — over 7 / 28 days (needs a snapshot within a day / two days of the start)
 *   tracked  — since the first snapshot, once that is at least a day old
 * `current` is { metric, value, at } (the latest data, usually also the newest snapshot).
 */
export function metricChanges(snapshots, current, now = Date.now()) {
  const none = { previous: null, d7: null, d28: null, tracked: null };
  if (!current || !Number.isFinite(current.value)) return none;
  // Only snapshots from before the current data count as a baseline.
  const older = snapshots.filter((s) => s.at < current.at - 60 * 1000 && Number.isFinite(s.metrics?.[current.metric]));
  if (!older.length) return none;
  const first = older[0];
  return {
    previous: change(current, older[older.length - 1]),
    d7: change(current, nearest(older, current.metric, now - 7 * DAY, DAY)),
    d28: change(current, nearest(older, current.metric, now - 28 * DAY, 2 * DAY)),
    tracked: current.at - first.at >= DAY ? change(current, first) : null,
  };
}

/** The change to show beside a counter: 7 days, else since tracking began, else null. */
export function headlineChange(changes) {
  if (changes.d7) return { ...changes.d7, label: '7d' };
  if (changes.tracked) return { ...changes.tracked, label: 'since tracking' };
  return null;
}
