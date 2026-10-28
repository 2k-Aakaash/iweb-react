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
  about: { from: '#a3a6ad', to: '#6c6f77', glyph: (
    <>
      <circle cx="12" cy="7.3" r="1.3" fill="#fff" stroke="none" />
      <path d="M12 11v7" />
    </>
  ) },
};

const MAC_ICON = { general: 'settings', wallpaper: 'wallpaper', music: 'music', notes: 'notes' };

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
