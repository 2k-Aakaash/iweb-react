import { useEffect, useState } from 'react';
import { getFavicon, peekFavicon } from './faviconCache';

/**
 * Cached icons for a list of domains: { [domain]: objectUrl | null }. A domain is absent while
 * its IndexedDB lookup runs (a few ms; render nothing yet), then holds its icon, or null when
 * nothing is cached and the API had no icon (fall back to the network icons then).
 */
export function useFavicons(domains) {
  const key = [...new Set(domains.filter(Boolean))].sort().join('|');
  // Whatever the preload already has in memory is used on the very first render.
  const [icons, setIcons] = useState(() => {
    const known = {};
    for (const domain of key ? key.split('|') : []) {
      const url = peekFavicon(domain);
      if (url !== undefined) known[domain] = url;
    }
    return known;
  });

  useEffect(() => {
    let alive = true;
    const set = (domain, url) => {
      if (!alive) return;
      const value = url ?? null;
      setIcons((prev) => (prev[domain] === value ? prev : { ...prev, [domain]: value }));
    };
    for (const domain of key ? key.split('|') : []) {
      getFavicon(domain, { onUpdate: (url) => set(domain, url) }).then((url) => set(domain, url));
    }
    return () => {
      alive = false;
    };
  }, [key]);

  return icons;
}
