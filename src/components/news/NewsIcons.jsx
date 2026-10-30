// Small original glyphs for News (no Apple artwork).

/** A folded newspaper. */
export function NewsGlyph({ size = 16 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4 5.5h12.5v12a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z" />
      <path d="M16.5 9H20v8.5a2 2 0 0 1-2 2" />
      <path d="M7.5 9h5.5M7.5 12.5h5.5M7.5 16h3.5" />
    </svg>
  );
}

export function ExternalGlyph({ size = 12 }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M5 2.5H3a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5V7" />
      <path d="M7 2.5h2.5V5M9.5 2.5 5.5 6.5" />
    </svg>
  );
}

export function RefreshGlyph({ size = 14 }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 2.5v3h-3" />
    </svg>
  );
}

export function SearchGlyph({ size = 14 }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </svg>
  );
}

export function BackGlyph({ size = 14 }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M10 3 5 8l5 5" />
    </svg>
  );
}
