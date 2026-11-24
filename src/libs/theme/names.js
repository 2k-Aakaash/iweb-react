// The names apps are shown by (Dock labels, menus, window titles, Apps), in one place so a
// theme can rename them (docs/THEMES.md).
import { useMemo } from 'react';
import { createOverrides } from './overrides';

export const APP_NAMES = Object.freeze({
  apps: 'Apps',
  wallpaper: 'Wallpapers',
  notes: 'Notes',
  music: 'Music',
  settings: 'Settings',
  markets: 'Markets',
  news: 'News',
  atmosphere: 'Atmosphere',
  frontier: 'Frontier World',
  spotlight: 'Spotlight',
  widgets: 'Widgets',
  themes: 'Theme Store',
});

// Where a surface has its own wording for an app (a theme's name replaces these too).
const IN_CONTEXT = { dock: { wallpaper: 'Change BG', music: 'Music Library' } };

export const themedNames = createOverrides();

/** The name of app `id`, as `context` ('dock', or none) shows it. */
export function appName(id, context) {
  return themedNames.get(id) ?? IN_CONTEXT[context]?.[id] ?? APP_NAMES[id] ?? id;
}

/**
 * appName, re-rendering the caller when a theme renames apps. The function itself changes
 * then too, so memoised lists that call it can depend on it.
 */
export function useAppName() {
  const names = themedNames.use();
  return useMemo(() => {
    void names; // a new function for each set of names
    return (id, context) => appName(id, context);
  }, [names]);
}
