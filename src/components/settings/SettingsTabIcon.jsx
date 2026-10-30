import MacAppIcon from '../icons/MacAppIcon';

// Settings sidebar icons, as in macOS 26 System Settings: small rounded tiles with a white
// glyph. General, Wallpaper and Music use the macOS app icons (MacAppIcon); the rest, and the
// stand-ins shown while those load or when offline, are drawn here (original artwork).

const TILES = {
  general: { from: '#a3a6ad', to: '#6c6f77', glyph: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6" />
      <circle cx="12" cy="12" r="6.2" />
    </>
  ) },
  appearance: { from: '#3a3a3e', to: '#0d0d0f', glyph: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 5a7 7 0 0 1 0 14z" fill="#fff" />
    </>
  ) },
  wallpaper: { from: '#4fd8f7', to: '#13a4dc', glyph: (
    <>
      <circle cx="15.5" cy="8.5" r="1.8" />
      <path d="m4 17 5-5.5 3.5 3.5 2.5-2.5L20 17" />
    </>
  ) },
  music: { from: '#ff6d86', to: '#f5213f', glyph: (
    <>
      <path d="M9.5 17V6.5l9-2V15" />
      <circle cx="7.3" cy="17" r="2.2" fill="#fff" />
      <circle cx="16.3" cy="15" r="2.2" fill="#fff" />
    </>
  ) },
  bookmarks: { from: '#5aaeff', to: '#0a64eb', glyph: (
    <path d="M7 4.5h10v15l-5-3.6-5 3.6z" fill="#fff" />
  ) },
  data_controls: { from: '#5fd97a', to: '#25a244', glyph: (
    <>
      <path d="M4.8 12a7.2 7.2 0 1 0 2.1-5.1" />
      <path d="M4.5 4.5v3.4h3.4" />
      <path d="M12 8.2V12l2.6 1.6" />
    </>
  ) },
  notes: { from: '#ffd84d', to: '#f7b500', glyph: (
    <path d="M7 8.5h10M7 12h10M7 15.5h6" />
  ) },
  restore: { from: '#a3a6ad', to: '#6c6f77', glyph: (
    <>
      <path d="M12 15V5M8 9l4-4 4 4" />
      <path d="M5 14v3.5A1.5 1.5 0 0 0 6.5 19h11a1.5 1.5 0 0 0 1.5-1.5V14" />
    </>
  ) },
  widgets: { from: '#5aaeff', to: '#0a64eb', glyph: (
    <>
      <rect x="4.5" y="4.5" width="6.5" height="6.5" rx="1.6" />
      <rect x="13" y="4.5" width="6.5" height="6.5" rx="1.6" />
      <rect x="4.5" y="13" width="15" height="6.5" rx="1.6" />
    </>
  ) },
  // Widget gallery (Settings → Widgets); clock, search, weather and markets use app icons.
  news: { from: '#ff6b6b', to: '#e8233a', glyph: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <path d="M8 9h8M8 12h8M8 15h5" />
    </>
  ) },
  stack: { from: '#8e8cf8', to: '#5b55e6', glyph: (
    <>
      <rect x="5" y="8" width="14" height="11" rx="2.2" fill="#fff" stroke="none" />
      <path d="M7 5.5h10" />
    </>
  ) },
  currency: { from: '#4cd07d', to: '#1f9d55', glyph: (
    <path d="M14.5 7.5h-4a2.25 2.25 0 0 0 0 4.5h3a2.25 2.25 0 0 1 0 4.5h-4.5M12 5.5v13" />
  ) },
  metals: { from: '#f7d774', to: '#c9921c', glyph: (
    <path d="M5 17.5h14l-2.2-5H7.2zM8.5 12.5l1.6-4h3.8l1.6 4" />
  ) },
  clock: { from: '#3a3a3e', to: '#0d0d0f', glyph: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 8v4l2.6 1.6" />
    </>
  ) },
  search: { from: '#a3a6ad', to: '#6c6f77', glyph: (
    <>
      <circle cx="11" cy="11" r="5.5" />
      <path d="m15.2 15.2 4 4" />
    </>
  ) },
  weather: { from: '#4fb6f7', to: '#1673d9', glyph: (
    <>
      <circle cx="10" cy="10" r="3" />
      <path d="M8.5 18h8a2.8 2.8 0 0 0 0-5.6 4 4 0 0 0-7.6 1.1A2.3 2.3 0 0 0 8.5 18z" fill="#fff" />
    </>
  ) },
  markets: { from: '#3a3a3e', to: '#0d0d0f', glyph: (
    <path d="m5 16 4.5-4.5 3 3L19 8" />
  ) },
  about: { from: '#a3a6ad', to: '#6c6f77', glyph: (
    <>
      <circle cx="12" cy="7.3" r="1.3" fill="#fff" stroke="none" />
      <path d="M12 11v7" />
    </>
  ) },
};

const MAC_ICON = {
  general: 'settings', wallpaper: 'wallpaper', music: 'music', notes: 'notes',
  clock: 'clock', search: 'spotlight', weather: 'weather', markets: 'stocks',
};

function Tile({ id }) {
  const tile = TILES[id];
  if (!tile) return null;
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`iws-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={tile.from} />
          <stop offset="1" stopColor={tile.to} />
        </linearGradient>
      </defs>
      <rect width="24" height="24" fill={`url(#iws-${id})`} />
      <g fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {tile.glyph}
      </g>
    </svg>
  );
}

/** `className` sizes it (default: the 22px sidebar tile). */
export default function SettingsTabIcon({ id, className = 'settings-tab-icon' }) {
  return MAC_ICON[id]
    ? <MacAppIcon name={MAC_ICON[id]} className={className} fallback={<Tile id={id} />} />
    : <span className={`${className} mac-app-icon`}><Tile id={id} /></span>;
}
