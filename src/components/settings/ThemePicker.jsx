import { useEffect, useRef, useState } from 'react';
import {
  BUILT_IN_THEME,
  installTheme,
  themePreviewUrl,
  uninstallTheme,
  selectTheme,
  applyThemeWallpaper,
  useThemes,
} from '../../libs/theme/engine';
import { showAlert, showConfirm } from '../../libs/dialogs/dialogs';
import { notify } from '../../libs/notifications/notifications';
import { openThemeStore } from '../../libs/theme/storeEvents';
import { themeSoundsPref } from '../../libs/theme/sounds';
import { usePref } from '../../libs/prefs/storedPref';
import '../../styles/settings-themes.css';

// Settings → Appearance → Theme: iWeb's own look and every installed theme, to use, update
// or remove, and "Install from File…" for a theme's .zip (docs/THEMES.md).

function Preview({ theme }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (theme.id === BUILT_IN_THEME || !theme.previews?.length) return undefined;
    let made = null;
    let live = true;
    themePreviewUrl(theme.id).then((u) => {
      made = u;
      if (live) setUrl(u);
      else if (u) URL.revokeObjectURL(u);
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [theme.id, theme.previews, theme.updatedAt]);
  if (theme.id === BUILT_IN_THEME) return <div className="th-preview th-preview-iweb" aria-hidden="true" />;
  if (url) return <img className="th-preview" src={url} alt="" draggable={false} />;
  return <div className="th-preview th-preview-none" aria-hidden="true">{theme.name.slice(0, 1)}</div>;
}

const BUILT_IN = { id: BUILT_IN_THEME, name: 'iWeb', author: 'iWeb', version: '', description: "iWeb's own look.", appearance: 'both' };
const APPEARANCE_NOTE = { dark: 'Dark only', light: 'Light only', both: '' };

export default function ThemePicker() {
  const { installed, applied, missing } = useThemes();
  const soundsOn = usePref(themeSoundsPref);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const themes = [BUILT_IN, ...installed];
  const [selected, setSelected] = useState(applied);
  const current = themes.find((t) => t.id === selected) || BUILT_IN;

  const install = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const theme = await installTheme(file, { source: 'file' });
      setSelected(theme.id);
      const parts = theme.removed?.length
        ? ` Some of its styling was left out because themes can't load outside files or run code (${theme.removed.length} ${theme.removed.length === 1 ? 'rule' : 'rules'}).`
        : '';
      notify({ app: 'iweb', title: `${theme.name} installed`, body: `Version ${theme.version}.${parts}` });
    } catch (err) {
      await showAlert({ title: "The theme couldn't be installed", message: err?.message || String(err) });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const apply = async (theme) => {
    selectTheme(theme.id);
    if (theme.hasWallpaper && await showConfirm({
      title: `Use ${theme.name}'s wallpaper too?`,
      message: 'It\'s added to your wallpapers, and stays there if you change theme later.',
      confirmLabel: 'Use Wallpaper',
      cancelLabel: 'Keep Mine',
    })) {
      await applyThemeWallpaper(theme.id).catch((err) => showAlert({ title: "The wallpaper couldn't be set", message: err?.message || String(err) }));
    }
  };

  const remove = async (theme) => {
    const ok = await showConfirm({
      title: `Remove ${theme.name}?`,
      message: theme.id === applied ? "iWeb's own look comes back." : 'You can install it again later.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    await uninstallTheme(theme.id);
    setSelected(applied === theme.id ? BUILT_IN_THEME : applied);
  };

  return (
    <>
      <div className="settings-group-card-title">Theme</div>
      <div className="settings-group-card th-card">
        {missing && (
          <div className="settings-row-hint th-missing">
            The theme “{missing}” isn't installed on this computer (it came with a backup or was removed in another tab). iWeb's own look is used until you install it again.
            {' '}
            <button type="button" className="th-link" onClick={() => openThemeStore(missing)}>Find it in the Theme Store</button>
          </div>
        )}
        <div className="th-grid" role="radiogroup" aria-label="Themes">
          {themes.map((theme) => (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={selected === theme.id}
              className={`th-item${selected === theme.id ? ' is-selected' : ''}`}
              onClick={() => setSelected(theme.id)}
              onDoubleClick={() => theme.id !== applied && apply(theme)}
            >
              <Preview theme={theme} />
              <span className="th-name">{theme.name}</span>
              {applied === theme.id && <span className="th-badge">In Use</span>}
            </button>
          ))}
        </div>

        <div className="th-details">
          <div className="th-text">
            <div className="th-title">
              {current.name}
              {current.version && <span className="th-meta"> {current.version}</span>}
            </div>
            <div className="th-meta">
              {[current.id !== BUILT_IN_THEME && `by ${current.author}`, APPEARANCE_NOTE[current.appearance], current.license].filter(Boolean).join(' · ')}
            </div>
            {current.description && <div className="th-desc">{current.description}</div>}
          </div>
          <div className="th-actions">
            {current.id !== BUILT_IN_THEME && (
              <button type="button" className="settings-btn" onClick={() => remove(current)}>Remove</button>
            )}
            {current.hasWallpaper && applied === current.id && (
              <button type="button" className="settings-btn" onClick={() => applyThemeWallpaper(current.id)}>Use Wallpaper</button>
            )}
            <button
              type="button"
              className="settings-btn settings-btn-primary"
              disabled={applied === current.id}
              onClick={() => apply(current)}
            >
              {applied === current.id ? 'In Use' : 'Use Theme'}
            </button>
          </div>
        </div>

        {installed.find((t) => t.id === applied)?.hasSounds && (
          <div className="settings-row th-sounds">
            <label className="settings-label" htmlFor="theme-sounds">Theme sounds</label>
            <input
              id="theme-sounds"
              type="checkbox"
              className="settings-switch"
              checked={soundsOn}
              onChange={(e) => themeSoundsPref.set(e.target.checked)}
            />
          </div>
        )}

        <div className="settings-row th-install">
          <span className="settings-row-hint th-install-hint">
            Themes change iWeb's fonts, colours, icons, glass and more. They're data only: they can't run code or load anything from the internet.
          </span>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => install(e.target.files?.[0])}
          />
          <div className="th-install-btns">
            <button type="button" className="settings-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? 'Installing…' : 'Install from File…'}
            </button>
            <button type="button" className="settings-btn settings-btn-primary" onClick={() => openThemeStore()}>
              Theme Store…
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
