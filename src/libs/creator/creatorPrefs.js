// Creator widget settings, kept in iWebDB like the other prefs (and so in backups): which
// account each widget shows and how often the widgets refresh. Accounts themselves (and their
// grants) live in creatorDb.js, never in backups.
import { createStoredPref, usePref } from '../prefs/storedPref.js';

// Minutes between automatic refreshes; 0 = only when asked. YouTube's public counts and both
// platforms' analytics change slowly, so the default is 30.
export const REFRESH_OPTIONS = [
  { minutes: 15, label: 'Every 15 minutes' },
  { minutes: 30, label: 'Every 30 minutes' },
  { minutes: 60, label: 'Every hour' },
  { minutes: 180, label: 'Every 3 hours' },
  { minutes: 0, label: 'Only when I refresh' },
];
export const DEFAULT_REFRESH_MINUTES = 30;

const ID_RE = /^youtube:[A-Za-z0-9_-]{1,64}$/;
const DEFAULTS = { youtube: null, refreshMinutes: DEFAULT_REFRESH_MINUTES };

export function normalizeCreatorPrefs(v) {
  if (!v || typeof v !== 'object') return null;
  const pick = (id, platform) => (typeof id === 'string' && ID_RE.test(id) && id.startsWith(`${platform}:`) ? id : null);
  return {
    youtube: pick(v.youtube, 'youtube'),
    refreshMinutes: REFRESH_OPTIONS.some((o) => o.minutes === v.refreshMinutes) ? v.refreshMinutes : DEFAULT_REFRESH_MINUTES,
  };
}

export const creatorPrefs = createStoredPref({
  key: 'creator_widgets',
  mirrorKey: 'iweb:creatorWidgets',
  fallback: DEFAULTS,
  normalize: normalizeCreatorPrefs,
});

export const useCreatorPrefs = () => usePref(creatorPrefs);

/** Shows `accountId` in its platform's widget. */
export function selectAccount(platform, accountId) {
  return creatorPrefs.set((prev) => ({ ...prev, [platform]: accountId }));
}

export function setRefreshMinutes(minutes) {
  return creatorPrefs.set((prev) => ({ ...prev, refreshMinutes: minutes }));
}

export const refreshIntervalMs = () => creatorPrefs.get().refreshMinutes * 60 * 1000;
