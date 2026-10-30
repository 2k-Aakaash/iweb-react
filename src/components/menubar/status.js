// Live values for the menu bar's status area: the time, the network and the battery.
import { useEffect, useState } from 'react';

/** The current time, updated on each minute boundary. */
export function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
    };
    timer = setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
    // Back from sleep or a background tab: catch up at once.
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(new Date());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return now;
}

export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/**
 * { level 0–1, charging } where the browser reports a battery, else null. Desktops report a
 * full, charging battery with no charge time left: treated as no battery (hidden, as macOS
 * does on desktop Macs).
 */
export function useBattery() {
  const [battery, setBattery] = useState(null);
  useEffect(() => {
    if (!navigator.getBattery) return undefined;
    let manager = null;
    let cancelled = false;
    const update = () => {
      if (!manager) return;
      const desktop = manager.charging && manager.level === 1 && manager.chargingTime === 0;
      setBattery(desktop ? null : { level: manager.level, charging: manager.charging });
    };
    navigator.getBattery().then((b) => {
      if (cancelled) return;
      manager = b;
      update();
      b.addEventListener('levelchange', update);
      b.addEventListener('chargingchange', update);
    }).catch(() => {});
    return () => {
      cancelled = true;
      manager?.removeEventListener('levelchange', update);
      manager?.removeEventListener('chargingchange', update);
    };
  }, []);
  return battery;
}

/** Whether the browser is in full screen (F11 or Enter Full Screen). */
export function useFullscreen() {
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  return fullscreen;
}
