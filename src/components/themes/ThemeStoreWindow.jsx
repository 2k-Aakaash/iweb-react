import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import GlassSurface from '../glass/GlassSurface';
import { useMacWindow } from '../../libs/window/useMacWindow';
import { selectTheme, useThemes, uninstallTheme, applyThemeWallpaper } from '../../libs/theme/engine';
import { STORE_PAGE, StoreError, cachedStore, installFromStore, loadStore, storePreviewUrl, updatesFor } from '../../libs/theme/storeIndex';
import { compareVersionsLite } from '../../libs/theme/versions';
import { showAlert, showConfirm } from '../../libs/dialogs/dialogs';
import { notify } from '../../libs/notifications/notifications';
import { openSettingsPane } from '../../libs/theme/storeEvents';
import '../../styles/atmosphere.css';
import '../../styles/theme-store.css';

// The Theme Store (docs/THEMES.md): the themes published in the iWeb themes repo on GitHub, to
// preview, install, update and use. Its own window (useMacWindow). Tabs:
//   Discover   every theme in the store
//   Installed  installed themes (also ones installed from a file)
//   Updates    store themes newer than the installed version

const TABS = [
  { id: 'discover', label: 'Discover' },
  { id: 'installed', label: 'Installed' },
  { id: 'updates', label: 'Updates' },
];
const APPEARANCE = { dark: 'Dark', light: 'Light', both: 'Light & Dark' };
const sizeLabel = (bytes) => (bytes ? `${(bytes / 1024 / 1024).toFixed(bytes < 1024 * 1024 ? 2 : 1)} MB` : '');

function StorePreview({ store, name, alt = '' }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!store || !name) return undefined;
    const ctl = new AbortController();
    storePreviewUrl(store, name, ctl.signal).then(setUrl, () => setUrl(null));
    return () => ctl.abort();
  }, [store, name]);
  return url ? <img className="ts-preview" src={url} alt={alt} draggable={false} /> : <div className="ts-preview ts-preview-empty" aria-hidden="true" />;
}

export default function ThemeStoreWindow({ open, setOpen, focusId = null }) {
  const windowRef = useRef(null);
  const overlayRef = useRef(null);
  const menusRef = useRef(null);
  const ids = useId();
  const win = useMacWindow({ app: 'themes', open, setOpen, windowRef, overlayRef, menus: menusRef });
  const { installed, applied } = useThemes();
  const [store, setStore] = useState(() => cachedStore());
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('discover');
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState(null); // a theme id
  const [busy, setBusy] = useState(null); // the id being installed

  const refresh = useCallback(async (force) => {
    setLoading(true);
    try {
      setStore(await loadStore({ force }));
      setError(null);
    } catch (err) {
      setError(err instanceof StoreError ? err : new StoreError('HTTP', String(err?.message || err)));
    } finally {
      setLoading(false);
    }
  }, []);

  // Loaded when the window opens (cached for a few hours).
  useEffect(() => {
    if (open) refresh(false); // eslint-disable-line react-hooks/set-state-in-effect
  }, [open, refresh]);

  // Opened for one theme (e.g. a theme from a backup that isn't installed).
  const [focusedFor, setFocusedFor] = useState(null);
  if (open && focusId && focusedFor !== focusId) {
    setFocusedFor(focusId);
    setDetail(focusId);
    setTab('discover');
  }

  useEffect(() => {
    menusRef.current = () => ({
      View: TABS.map((t) => ({ label: t.label, checked: tab === t.id, onSelect: () => { setDetail(null); setTab(t.id); } })),
      Controls: [{ label: 'Check for New Themes', onSelect: () => refresh(true) }],
    });
  });

  // Escape closes the details first, then the window (never while typing).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.target instanceof HTMLInputElement) return;
      if (detail) setDetail(null);
      else win.close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, win, detail]);

  const updates = useMemo(() => updatesFor(store, installed), [store, installed]);
  const storeThemes = useMemo(() => store?.themes || [], [store]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (t) => !q || [t.name, t.author, t.description, ...(t.tags || [])].join(' ').toLowerCase().includes(q);
    if (tab === 'installed') {
      return installed.map((t) => ({ ...storeThemes.find((s) => s.id === t.id), ...t, installedVersion: t.version, storeVersion: storeThemes.find((s) => s.id === t.id)?.version })).filter(match);
    }
    if (tab === 'updates') return updates.filter(match);
    return storeThemes.filter(match);
  }, [tab, query, installed, storeThemes, updates]);

  const entryOf = (id) => storeThemes.find((t) => t.id === id) || null;
  const installedOf = (id) => installed.find((t) => t.id === id) || null;

  const install = async (entry) => {
    setBusy(entry.id);
    const updating = Boolean(installedOf(entry.id));
    try {
      const theme = await installFromStore(store, entry);
      notify({ app: 'iweb', title: `${theme.name} ${updating ? 'updated' : 'installed'}`, body: `Version ${theme.version}.` });
    } catch (err) {
      await showAlert({ title: `${entry.name} couldn't be ${updating ? 'updated' : 'installed'}`, message: err?.message || String(err) });
    } finally {
      setBusy(null);
    }
  };

  const use = async (theme) => {
    selectTheme(theme.id);
    if (installedOf(theme.id)?.hasWallpaper && await showConfirm({
      title: `Use ${theme.name}'s wallpaper too?`,
      message: "It's added to your wallpapers, and stays there if you change theme later.",
      confirmLabel: 'Use Wallpaper',
      cancelLabel: 'Keep Mine',
    })) {
      await applyThemeWallpaper(theme.id).catch((err) => showAlert({ title: "The wallpaper couldn't be set", message: err?.message || String(err) }));
    }
  };

  const remove = async (theme) => {
    if (!await showConfirm({ title: `Remove ${theme.name}?`, message: theme.id === applied ? "iWeb's own look comes back." : 'You can install it again from the Theme Store.', confirmLabel: 'Remove', destructive: true })) return;
    await uninstallTheme(theme.id);
  };

  // The buttons for a theme, wherever it's shown.
  const actions = (id) => {
    const entry = entryOf(id);
    const mine = installedOf(id);
    const out = [];
    if (busy === id) return [<button key="busy" type="button" className="atm-btn ts-btn" disabled>{mine ? 'Updating…' : 'Installing…'}</button>];
    if (entry && (!mine || compareVersionsLite(entry.version, mine.version) > 0)) {
      out.push(<button key="get" type="button" className="atm-btn ts-btn is-primary" disabled={Boolean(busy)} onClick={() => install(entry)}>{mine ? 'Update' : 'Install'}</button>);
    }
    if (mine) {
      out.push(applied === id
        ? <span key="inuse" className="ts-inuse">In Use</span>
        : <button key="use" type="button" className="atm-btn ts-btn is-primary" onClick={() => use(mine)}>Use</button>);
    }
    return out;
  };

  if (!win.mounted) return null;

  const theme = detail && (entryOf(detail) || installedOf(detail));
  const mine = detail && installedOf(detail);

  return (
    <div ref={overlayRef} className="atm-overlay ts-overlay" onPointerDown={(e) => e.target === e.currentTarget && win.close()}>
      <div
        ref={windowRef}
        className={`atm-window ts-window glass-host${win.maximized ? ' window-maximized' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        tabIndex={-1}
      >
        <GlassSurface preset="window" />
        <div className="window-controls">
          <span className="window-dot dot-close" role="button" aria-label="Close" onClick={win.close} />
          <span className="window-dot dot-minimize" role="button" aria-label="Minimize" onClick={win.minimize} />
          <span className="window-dot dot-maximize" role="button" aria-label={win.maximized ? 'Exit full size' : 'Zoom'} onClick={win.toggleMaximize} />
        </div>
        <header className="ts-toolbar">
          <h1 id={`${ids}-title`} className="ts-title">Theme Store</h1>
          <div className="ts-tabs" role="tablist" aria-label="Show">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`ts-tab${tab === t.id ? ' is-active' : ''}`}
                onClick={() => { setDetail(null); setTab(t.id); }}
              >
                {t.label}
                {t.id === 'updates' && updates.length > 0 && <span className="ts-count">{updates.length}</span>}
              </button>
            ))}
          </div>
          <input
            type="search"
            className="ts-search"
            placeholder="Search themes"
            aria-label="Search themes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </header>

        <div className="ts-body">
          {theme ? (
            <section className="ts-detail" aria-label={theme.name}>
              <button type="button" className="ts-back" onClick={() => setDetail(null)}>‹ All Themes</button>
              <div className="ts-detail-head">
                <div>
                  <h2 className="ts-detail-name">{theme.name}</h2>
                  <div className="ts-meta">
                    {[`by ${theme.author}`, `Version ${theme.version}`, APPEARANCE[theme.appearance], theme.license, sizeLabel(theme.size)].filter(Boolean).join(' · ')}
                  </div>
                  {mine && entryOf(detail) && compareVersionsLite(entryOf(detail).version, mine.version) > 0 && (
                    <div className="ts-meta">Installed: version {mine.version}</div>
                  )}
                </div>
                <div className="ts-actions">
                  {actions(detail)}
                  {mine && <button type="button" className="atm-btn ts-btn" onClick={() => remove(mine)}>Remove</button>}
                </div>
              </div>
              {theme.description && <p className="ts-desc">{theme.description}</p>}
              {theme.tags?.length > 0 && <div className="ts-tags">{theme.tags.map((t) => <span key={t} className="ts-tag">{t}</span>)}</div>}
              <div className="ts-gallery">
                {(entryOf(detail)?.previews || []).map((p) => <StorePreview key={p} store={store} name={p} alt={`${theme.name} preview`} />)}
              </div>
              {!entryOf(detail) && <p className="ts-note">This theme was installed from a file, so it isn't in the Theme Store.</p>}
            </section>
          ) : (
            <>
              {error && (
                <div className="ts-status" role="status">
                  <p>{error.message}</p>
                  <button type="button" className="atm-btn ts-btn" onClick={() => refresh(true)}>Try Again</button>
                </div>
              )}
              {!error && loading && !store && <div className="ts-status" role="status"><p>Loading the Theme Store…</p></div>}
              {shown.length > 0 ? (
                <ul className="ts-grid">
                  {shown.map((t) => (
                    <li key={t.id} className="ts-card">
                      <button type="button" className="ts-card-main" onClick={() => setDetail(t.id)}>
                        <StorePreview store={store} name={t.previews?.[0]} />
                        <span className="ts-card-name">{t.name}</span>
                        <span className="ts-meta">{t.author}{t.appearance !== 'both' && ` · ${APPEARANCE[t.appearance]} only`}</span>
                      </button>
                      <div className="ts-card-actions">{actions(t.id)}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                !loading && !(error && tab === 'discover') && (
                  <div className="ts-status">
                    <p>
                      {query ? 'No themes match your search.'
                        : tab === 'updates' ? 'All your themes are up to date.'
                          : tab === 'installed' ? 'No themes installed yet.'
                            : 'No themes in the store yet.'}
                    </p>
                  </div>
                )
              )}
            </>
          )}
        </div>

        <footer className="ts-footer">
          <span className="ts-meta">
            Themes are data only: they can't run code or load anything from the internet, and every download is checked before it's installed.
          </span>
          <span className="ts-footer-links">
            <button type="button" className="ts-link" onClick={() => openSettingsPane('appearance')}>Theme Settings</button>
            <a className="ts-link" href={STORE_PAGE} target="_blank" rel="noopener noreferrer">Make a Theme</a>
          </span>
        </footer>
      </div>
    </div>
  );
}
