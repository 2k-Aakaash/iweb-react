// Turning account data into the metrics the Creator widgets show (CreatorWidget's shape).
// Growth comes from snapshots on this device only (snapshots.js); missing values carry a
// reason instead of a number.
import { formatDate, formatDelta } from '../../libs/creator/creatorFormat';
import { headlineChange, metricChanges } from '../../libs/creator/snapshots';

/** The growth note beside a counter ("+1.2K 7d"), or null without enough history. */
export function growth(snapshots, metric, value, at) {
  const c = headlineChange(metricChanges(snapshots || [], { metric, value, at }));
  if (!c) return null;
  return {
    text: `${formatDelta(c.delta)} ${c.label}`,
    dir: c.delta > 0 ? 'up' : c.delta < 0 ? 'down' : 'flat',
    title: `Change since ${formatDate(c.since)}, worked out from the updates saved on this device.`,
  };
}

/** Rows for every growth window of a counter (large size). */
export function growthRows(snapshots, metric, label, value, at) {
  const changes = metricChanges(snapshots || [], { metric, value, at });
  const row = (key, name) => ({
    id: `${metric}-${key}`,
    label: `${label}, ${name}`,
    value: changes[key] ? formatDelta(changes[key].delta) : null,
    missing: 'Not enough history',
    title: changes[key]
      ? `Since ${formatDate(changes[key].since)}, from updates saved on this device.`
      : 'iWeb needs updates saved on this device from that long ago. Keep the widget on the desktop and this fills in.',
  });
  return [row('d7', '7 days'), row('d28', '28 days'), row('tracked', 'since tracking began')];
}
