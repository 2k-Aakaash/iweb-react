import { useState } from 'react';
import { themedIcons } from '../../libs/theme/icons';
import '../../styles/mac-app-icon.css';

// macOS 26 app icons, hosted on ImageKit (iweb-icons/). Each SVG is the full 1024px icon
// canvas: the tile fills the middle ~80%, ringed by its drop shadow (traced as a solid dark
// outline), so .mac-app-icon crops to the tile. Cached by the browser for a year.
const BASE = 'https://ik.imagekit.io/026k2i7ys/iweb-icons/';

const MAC_APP_ICONS = {
  apps: `${BASE}Apps.svg`,
  wallpaper: `${BASE}Wallpaper.svg`,
  notes: `${BASE}Notes.svg`,
  music: `${BASE}Music.svg`,
  settings: `${BASE}System%20Settings.svg`,
  weather: `${BASE}Weather.svg`,
  clock: `${BASE}Clock.svg`,
  stocks: `${BASE}Stocks.svg`,
  spotlight: `${BASE}Spotlight.svg`,
};

/**
 * An app icon: the theme's icon for `name` (libs/theme/icons.js), shown whole, or the macOS
 * icon cropped to its rounded tile. `fallback` shows until the image has loaded, and stays if
 * it can't load (offline) or there's no image for `name`.
 */
export default function MacAppIcon({ name, className = '', fallback = null }) {
  const themed = themedIcons.use()[name];
  const src = themed || MAC_APP_ICONS[name];
  // Per image, so a new theme's icon starts hidden again until it has loaded.
  const [loaded, setLoaded] = useState(null);
  const [failed, setFailed] = useState(null);
  const state = loaded === src ? 'loaded' : failed === src ? 'failed' : 'loading';
  return (
    <span className={`mac-app-icon${themed ? ' is-themed' : ''} ${className}`}>
      {state !== 'loaded' && fallback}
      {src && state !== 'failed' && (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          className={state === 'loaded' ? 'is-loaded' : undefined}
          onLoad={() => setLoaded(src)}
          onError={() => setFailed(src)}
        />
      )}
    </span>
  );
}
