// App icons a theme replaces (docs/THEMES.md), by key: the macOS icon names MacAppIcon knows
// (apps, wallpaper, notes, music, settings, weather, clock, stocks, spotlight), the apps
// that only have a drawn icon (atmosphere, frontier, news) and the Settings panes
// (settings-<pane>). A theme icon is a URL to a whole image (its own shape and margins),
// shown uncropped.
import { createOverrides } from './overrides';

export const themedIcons = createOverrides();

// Glass looks a theme sets per surface (components/glass/glassPresets.js fields), for Dark
// and for Light: { dark: { window: {...} }, light: { ... }, off }. `off`: no glass at all
// (no blur or refraction); surfaces show only the theme's --glass-tint material.
export const themedGlass = createOverrides();
