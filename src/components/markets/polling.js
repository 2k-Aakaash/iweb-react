import { useSyncExternalStore } from 'react';

// Shared by the Markets card and the Markets app: adaptive polling with abortable requests,
// and the page-visibility state that pauses it.

/**
 * Runs `task(signal)` now, then again after the delay (ms) its promise resolves to, until
 * the returned stop function is called. Resolve to null to stop polling. Stopping aborts
 * the request in flight and clears the pending timer. Tasks handle their own errors.
 */
export function startPolling(task) {
  let timer = 0;
  let controller = null;
  let stopped = false;

  const run = () => {
    const current = new AbortController();
    controller = current;
    let pending;
    try {
      pending = task(current.signal);
    } catch {
      return;
    }
    Promise.resolve(pending).then(
      (delay) => {
        if (stopped || current.signal.aborted || typeof delay !== 'number' || !Number.isFinite(delay)) return;
        timer = setTimeout(run, Math.max(0, delay));
      },
      () => {},
    );
  };

  run();
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
  };
}

function subscribeVisibility(callback) {
  document.addEventListener('visibilitychange', callback);
  return () => document.removeEventListener('visibilitychange', callback);
}

const isPageVisible = () => document.visibilityState !== 'hidden';
const serverVisible = () => true;

function subscribeOnline(callback) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

const isOnline = () => navigator.onLine !== false;

/** False while the browser reports being offline. */
export function useOnline() {
  return useSyncExternalStore(subscribeOnline, isOnline, serverVisible);
}

/** True while the tab is visible (polling pauses while it is hidden). */
export function usePageVisible() {
  return useSyncExternalStore(subscribeVisibility, isPageVisible, serverVisible);
}
