import MacAppIcon from '../icons/MacAppIcon';

// App icons for iWeb's built-in Dock items: the macOS 26 icons (MacAppIcon), over drawn
// stand-ins in the same style (a full-bleed tile with a soft vertical gradient, a bold glyph and
// a light sheen) that show while an icon loads or when it can't. Gradient ids are prefixed
// `iwd-` to stay unique.

function Tile({ id, from, to, children }) {
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`iwd-${id}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
        <linearGradient id={`iwd-${id}-sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.32" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill={`url(#iwd-${id}-bg)`} />
      {children}
      <rect width="64" height="64" fill={`url(#iwd-${id}-sheen)`} />
    </svg>
  );
}

const ICONS = {
  // Add app: a white plus on blue.
  add: (
    <Tile id="add" from="#5cb0ff" to="#0a60eb">
      <path d="M32 19v26M19 32h26" stroke="#003a99" strokeOpacity="0.25" strokeWidth="6.5" strokeLinecap="round" transform="translate(0 1.2)" />
      <path d="M32 19v26M19 32h26" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" />
    </Tile>
  ),

  // Change background: a sunset landscape.
  bg: (
    <Tile id="bg" from="#4f7dff" to="#ffad66">
      <circle cx="44" cy="23" r="6.5" fill="#fff6d5" />
      <path d="M0 47 18 29l11 10 14-15 21 21v19H0z" fill="#6c5ce7" fillOpacity="0.92" />
      <path d="M0 53c11-9 22-9 33-2s21 6 31-1v14H0z" fill="#33277f" />
    </Tile>
  ),

  // Notes: a ruled page under a yellow band.
  notes: (
    <Tile id="notes" from="#ffffff" to="#ededf0">
      <rect width="64" height="17" fill="#ffd426" />
      <path d="M0 17h64" stroke="#e0b000" strokeWidth="1.5" />
      <path d="M11 28h42M11 36h42M11 44h42M11 52h28" stroke="#c7c7cc" strokeWidth="2.2" strokeLinecap="round" />
    </Tile>
  ),

  // Music: beamed notes on red-pink.
  music: (
    <Tile id="music" from="#ff6d86" to="#f5213f">
      <g fill="#fff">
        <path d="M24.5 18.5 45 13.5v6l-20.5 5z" />
        <rect x="24.5" y="19" width="3.4" height="26" rx="1.2" />
        <rect x="41.6" y="14" width="3.4" height="25" rx="1.2" />
        <ellipse cx="21" cy="45" rx="6.8" ry="5.2" transform="rotate(-20 21 45)" />
        <ellipse cx="38.1" cy="39.5" rx="6.8" ry="5.2" transform="rotate(-20 38.1 39.5)" />
      </g>
    </Tile>
  ),

  // Settings: a machined gear on graphite.
  settings: (
    <Tile id="settings" from="#c3c7ce" to="#6b7079">
      <g fill="#3b3f46">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <rect key={angle} x="28.5" y="8.5" width="7" height="11" rx="1.8" transform={`rotate(${angle} 32 32)`} />
        ))}
        <circle cx="32" cy="32" r="17" />
      </g>
      <circle cx="32" cy="32" r="11.5" fill="#d6d9de" />
      <circle cx="32" cy="32" r="11.5" fill="none" stroke="#fff" strokeOpacity="0.5" strokeWidth="1" />
      <circle cx="32" cy="32" r="5" fill="#3b3f46" />
    </Tile>
  ),
};

// Each Dock item's macOS 26 icon (MacAppIcon); the drawing above shows while it loads or if it
// can't (offline).
const MAC_ICON = { add: 'apps', bg: 'wallpaper', notes: 'notes', music: 'music', settings: 'settings' };

export default function DockAppIcon({ name, className }) {
  return <MacAppIcon name={MAC_ICON[name]} className={className} fallback={ICONS[name]} />;
}
