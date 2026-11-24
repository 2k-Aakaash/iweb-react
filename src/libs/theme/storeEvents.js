// Opening the Theme Store (App.jsx mounts it on first open), optionally on one theme.
export const THEME_STORE_OPEN_EVENT = 'themes:open';

export function openThemeStore(themeId = null) {
  window.dispatchEvent(new CustomEvent(THEME_STORE_OPEN_EVENT, { detail: { themeId } }));
}

/** Settings on a pane ('appearance'…). */
export function openSettingsPane(tab) {
  window.dispatchEvent(new CustomEvent('settings:open', { detail: { tab } }));
}
