import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { accountsOf, getState, loadConfig, loadSnapshots, subscribe, watchAccount } from './creatorStore.js';
import { useCreatorPrefs } from './creatorPrefs.js';

/** The whole creator state (accounts, refresh status, snapshots, server config). */
export function useCreatorState() {
  return useSyncExternalStore(subscribe, getState, getState);
}

/** A platform's accounts, oldest first. */
export function useCreatorAccounts(platform) {
  const snapshot = useCreatorState();
  return useMemo(() => accountsOf(snapshot, platform), [snapshot, platform]);
}

/** What this iWeb server supports; asked once per page. */
export function useCreatorConfig() {
  const { config } = useCreatorState();
  useEffect(() => {
    loadConfig();
  }, []);
  return config;
}

/**
 * The account a platform's widget shows (the one chosen, else the first), kept fresh while
 * the widget is mounted, with its snapshots for growth indicators.
 */
export function useWidgetAccount(platform) {
  const snapshot = useCreatorState();
  const prefs = useCreatorPrefs();
  const accounts = useMemo(() => accountsOf(snapshot, platform), [snapshot, platform]);
  const account = accounts.find((a) => a.id === prefs[platform]) || accounts[0] || null;
  const id = account?.id || null;

  useEffect(() => {
    if (!id) return undefined;
    loadSnapshots(id);
    return watchAccount(id);
  }, [id]);

  return {
    ready: snapshot.ready,
    accounts,
    account,
    refreshing: Boolean(id && snapshot.refreshing[id]),
    snapshots: (id && snapshot.snapshots[id]) || null,
  };
}
