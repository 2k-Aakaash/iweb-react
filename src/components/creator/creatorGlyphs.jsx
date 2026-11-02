// Glyphs for the Creator widgets (original artwork): a play tile, a camera, likes, comments.

export const PlayGlyph = ({ size = 14 }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
    <rect x="1.5" y="3.5" width="13" height="9" rx="2.6" fill="currentColor" opacity="0.95" />
    <path d="M6.6 5.9v4.2L10.2 8z" fill="var(--crw-glyph-cut, #e32a2a)" />
  </svg>
);

export const CameraGlyph = ({ size = 14 }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
    <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="3.4" />
    <circle cx="8" cy="8" r="2.7" />
    <circle cx="11.4" cy="4.6" r="0.75" fill="currentColor" stroke="none" />
  </svg>
);

export const HeartGlyph = () => (
  <svg className="crw-stat-glyph" viewBox="0 0 12 12" width="10" height="10" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M6 10.4 1.7 6.3A2.6 2.6 0 0 1 6 2.9a2.6 2.6 0 0 1 4.3 3.4z" />
  </svg>
);

export const CommentGlyph = () => (
  <svg className="crw-stat-glyph" viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true" focusable="false">
    <path d="M6 1.8c2.5 0 4.3 1.6 4.3 3.7S8.5 9.2 6 9.2c-.5 0-1-.1-1.4-.2L2.2 10l.6-1.9C2.1 7.4 1.7 6.5 1.7 5.5c0-2.1 1.8-3.7 4.3-3.7z" strokeLinejoin="round" />
  </svg>
);
