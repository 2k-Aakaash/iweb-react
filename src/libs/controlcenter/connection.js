// The network as a page can see it, for Control Center's Wi-Fi tile: online or not and, where
// the browser tells (the Network Information API, Chromium), the kind of connection and its
// estimated speed. A page can't switch Wi-Fi or see the network's name.
import { useSyncExternalStore } from 'react';

const OFFLINE = Object.freeze({ online: false, type: '', effectiveType: '', downlink: null, rtt: null, saveData: false });

let snapshot = null;
let key = '';

function read() {
  if (typeof navigator === 'undefined') return OFFLINE;
  const c = navigator.connection || {};
  const next = {
    online: navigator.onLine,
    type: c.type || '', // 'wifi', 'ethernet', 'cellular'… (often absent on desktops)
    effectiveType: c.effectiveType || '', // 'slow-2g' | '2g' | '3g' | '4g'
    downlink: Number.isFinite(c.downlink) ? c.downlink : null, // Mbit/s, estimated
    rtt: Number.isFinite(c.rtt) ? c.rtt : null, // ms, estimated
    saveData: Boolean(c.saveData),
  };
  const nextKey = JSON.stringify(next);
  if (nextKey !== key) {
    key = nextKey;
    snapshot = next;
  }
  return snapshot;
}

function subscribe(listener) {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  navigator.connection?.addEventListener?.('change', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
    navigator.connection?.removeEventListener?.('change', listener);
  };
}

export function useConnection() {
  return useSyncExternalStore(subscribe, read, () => OFFLINE);
}

/** The Wi-Fi tile's second line: "Connected", "Wi-Fi", "4G-class" or "Offline". */
export function connectionSummary(c) {
  if (!c.online) return 'Not Connected';
  if (c.type === 'wifi') return 'Wi-Fi';
  if (c.type === 'ethernet') return 'Ethernet';
  if (c.type === 'cellular') return 'Cellular';
  return 'Connected';
}

/** A connection's estimated quality, from the effective type the browser reports. */
export function speedLabel(c) {
  return { 'slow-2g': 'Very slow', '2g': 'Slow', '3g': 'Moderate', '4g': 'Fast' }[c.effectiveType] || 'Unknown';
}
