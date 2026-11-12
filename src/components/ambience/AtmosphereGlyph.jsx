import '../../styles/ambience-island.css';

// Atmosphere's small glyph: an orb of soft light (the island, the window title). `live` lets
// it drift slowly while ambience plays; it's still otherwise.
export default function AtmosphereGlyph({ size = 22, live = false, palette = ['#5b8cff', '#b16cea'], className = '' }) {
  return (
    <span
      className={`atm-orb${live ? ' is-live' : ''}${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, '--atm-a': palette[0], '--atm-b': palette[1] }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" width="62%" height="62%" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M3 13c2-3 3.6-3 5.3 0s3.4 3 5.4 0 3.6-3 5.3 0" />
        <path d="M5 8.5c1.6-2 3-2 4.4 0s2.8 2 4.4 0 2.8-2 4.2 0" opacity="0.6" />
      </svg>
    </span>
  );
}
