// Settings → Appearance → Accent Colour, as in macOS 26. Saved in iWebDB and included in
// backups. Written to <html data-accent="…">; styles/accent.css turns it into --accent-rgb,
// and every accent blue in the CSS reads that (scripts/postcss-accent.mjs), so buttons,
// selections, switches, sliders, checkboxes, links and focus rings all follow it.
// Multicolor is the default: blue, as in macOS.
import { createStoredPref } from '../prefs/storedPref.js';

export const ACCENTS = [
  { id: 'multicolor', label: 'Multicolor' },
  { id: 'blue', label: 'Blue' },
  { id: 'purple', label: 'Purple' },
  { id: 'pink', label: 'Pink' },
  { id: 'red', label: 'Red' },
  { id: 'orange', label: 'Orange' },
  { id: 'yellow', label: 'Yellow' },
  { id: 'green', label: 'Green' },
  { id: 'graphite', label: 'Graphite' },
];

export const normalizeAccent = (v) => (ACCENTS.some((a) => a.id === v) ? v : null);

export const accentPref = createStoredPref({
  key: 'accent_colour',
  mirrorKey: 'iweb:accent',
  fallback: 'multicolor',
  normalize: normalizeAccent,
});

/** Keeps <html data-accent> in step with the setting. */
export function startAccent() {
  const apply = () => {
    const root = document.documentElement;
    const accent = accentPref.get();
    if (root.dataset.accent !== accent) root.dataset.accent = accent;
  };
  apply();
  accentPref.subscribe(apply);
}
