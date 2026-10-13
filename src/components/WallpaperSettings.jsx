import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  getWallpaperSettings,
  setWallpaperSettings,
  getActiveWallpaper,
  setActiveWallpaper
} from '../libs/wallpaper/settings';
import { subscribe } from '../libs/wallpaper/sync';
import { getQuotaStatus } from '../libs/wallpaper/quotaLimiter';
import { listLocal, listUnsplash, deleteWallpapers } from '../libs/wallpaper/repository';
import { importLocalFiles } from '../libs/wallpaper/importManager';
import { backfillThumbnails } from '../libs/wallpaper/thumbnails';
import { isUnsplashConfigured } from '../libs/wallpaper/unsplashClient';
import SegmentedControl from './wallpaper/SegmentedControl';
import LocalImportPanel from './wallpaper/LocalImportPanel';
import UnsplashPanel from './wallpaper/UnsplashPanel';
import WallpaperGallery from './wallpaper/WallpaperGallery';
import ConfirmDialog from './wallpaper/ConfirmDialog';
import { describeWallpaperError, isAbortError, plural, refKey, sameRef } from './wallpaper/wallpaperUi';
import '../styles/wallpaper-settings.css';

const SOURCE_OPTIONS = [
  { value: 'local', label: 'Local Images' },
  { value: 'unsplash', label: 'Unsplash' }
];

const IDLE_IMPORT = {
  running: false,
  cancelling: false,
  progress: { done: 0, total: 0, current: '' },
  summary: null,
  error: ''
};

const MAX_TIMEOUT_MS = 2147483647;

const subscribeOnline = (callback) => {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
};
const getOnline = () => navigator.onLine;
const getOnlineServer = () => true;

// Reuse the previous Blob object when a refresh returns an identical one, so cards keep
// their object URL instead of re-creating it on every library-changed signal.
function stableBlob(cache, key, blob) {
  if (!blob) return null;
  const prev = cache.get(key);
  if (prev && prev.size === blob.size && prev.type === blob.type) return prev;
  return blob;
}

const MAX_ORIGINAL_PREVIEW_BYTES = 300 * 1024;

function buildItems(localRecords, unsplashRecords, blobCache) {
  const nextCache = new Map();

  const local = localRecords.map((r) => {
    const key = refKey({ source: 'local', id: r.id });
    // Until the backfill creates a thumbnail, only small non-GIF originals are shown;
    // large images and GIFs get a placeholder so the gallery never decodes them at full size.
    const smallOriginal = r.blob && r.blob.size <= MAX_ORIGINAL_PREVIEW_BYTES && r.blob.type !== 'image/gif';
    const thumbBlob = stableBlob(blobCache, key, r.thumb || (smallOriginal ? r.blob : null));
    if (thumbBlob) nextCache.set(key, thumbBlob);
    return {
      key,
      ref: { source: 'local', id: r.id },
      source: 'local',
      thumbBlob,
      thumbUrl: null,
      color: null,
      title: r.name || `Image ${r.id}`,
      photographer: null,
      photoPageUrl: null,
      time: r.createdAt || 0
    };
  });
  // Newest first; legacy records without createdAt fall back to id order.
  local.sort((a, b) => (b.time - a.time) || (b.ref.id - a.ref.id));

  const unsplash = unsplashRecords.map((r) => {
    const key = refKey({ source: 'unsplash', id: r.photoId });
    const hotlink = r.urls?.thumb || null;
    const thumbBlob = stableBlob(blobCache, key, r.thumb || (hotlink ? null : r.blob) || null);
    if (thumbBlob) nextCache.set(key, thumbBlob);
    const name = r.photographer?.name;
    return {
      key,
      ref: { source: 'unsplash', id: r.photoId },
      source: 'unsplash',
      thumbBlob,
      thumbUrl: thumbBlob ? null : hotlink,
      color: r.color || null,
      title: r.description || (name ? `Photo by ${name}` : 'Unsplash photo'),
      photographer: r.photographer || null,
      photoPageUrl: r.photoPageUrl || null,
      time: r.acquiredAt || 0
    };
  });

  return { local, unsplash, nextCache };
}

export default function WallpaperSettings({ isOpen }) {
  const [settings, setSettings] = useState(() => getWallpaperSettings());
  const [active, setActive] = useState(() => getActiveWallpaper());
  const [library, setLibrary] = useState({ local: [], unsplash: [], loaded: false, error: '' });
  const [quota, setQuota] = useState(null);
  const [filter, setFilter] = useState('all');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [galleryNotice, setGalleryNotice] = useState(null);
  const [importState, setImportState] = useState(IDLE_IMPORT);
  const [announcement, setAnnouncement] = useState('');

  const blobCacheRef = useRef(new Map());
  const librarySeqRef = useRef(0);
  const quotaSeqRef = useRef(0);
  const importControllerRef = useRef(null);
  const deletingRef = useRef(false);

  const reduceMotion = useReducedMotion();
  const online = useSyncExternalStore(subscribeOnline, getOnline, getOnlineServer);
  const unsplashConfigured = isUnsplashConfigured();

  const refreshLibrary = useCallback(async () => {
    const seq = ++librarySeqRef.current;
    try {
      const [localRecords, unsplashRecords] = await Promise.all([listLocal(), listUnsplash()]);
      if (seq !== librarySeqRef.current) return;
      const { local, unsplash, nextCache } = buildItems(localRecords || [], unsplashRecords || [], blobCacheRef.current);
      blobCacheRef.current = nextCache;
      setLibrary({ local, unsplash, loaded: true, error: '' });
    } catch (err) {
      if (seq !== librarySeqRef.current) return;
      console.error('Failed to load wallpapers:', err);
      setLibrary((prev) => ({ ...prev, loaded: true, error: 'Couldn’t load your wallpapers. Try reopening Settings.' }));
    }
  }, []);

  const refreshQuota = useCallback(async () => {
    const seq = ++quotaSeqRef.current;
    try {
      const status = await getQuotaStatus();
      if (seq === quotaSeqRef.current) setQuota(status);
    } catch (err) {
      console.error('Failed to read the Unsplash allowance:', err);
    }
  }, []);

  // Initial load whenever the panel is open, then follow changes from this and other tabs.
  useEffect(() => {
    if (!isOpen) return undefined;
    let disposed = false;

    (async () => {
      await Promise.all([refreshLibrary(), refreshQuota()]);
      if (disposed) return;
      // Creates thumbnails for older records; broadcasts library-changed when done.
      backfillThumbnails().catch((err) => console.warn('Thumbnail backfill failed:', err));
      setSettings(getWallpaperSettings());
      setActive(getActiveWallpaper());
    })();

    const unsubscribe = subscribe(({ type }) => {
      if (type === 'library-changed') refreshLibrary();
      else if (type === 'active-changed') setActive(getActiveWallpaper());
      else if (type === 'quota-changed') refreshQuota();
      else if (type === 'settings-changed') setSettings(getWallpaperSettings());
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [isOpen, refreshLibrary, refreshQuota]);

  // Re-read the allowance right after local midnight so the meter resets on its own.
  useEffect(() => {
    if (!quota || quota.resetsAt === null || quota.resetsAt === undefined) return undefined;
    const at = new Date(quota.resetsAt).getTime();
    if (Number.isNaN(at)) return undefined;
    const delay = Math.min(Math.max(at - Date.now(), 0) + 1000, MAX_TIMEOUT_MS);
    const timer = setTimeout(refreshQuota, delay);
    return () => clearTimeout(timer);
  }, [quota, refreshQuota]);

  const announce = useCallback((text) => setAnnouncement(text), []);

  const updateSettings = useCallback((patch) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    try {
      Promise.resolve(setWallpaperSettings(patch))
        .then((next) => {
          if (next && typeof next === 'object') setSettings(next);
        })
        .catch((err) => console.error('Failed to save wallpaper settings:', err));
    } catch (err) {
      console.error('Failed to save wallpaper settings:', err);
    }
  }, []);

  // ── Derived library views ────────────────────────────────────────────────
  const allItems = useMemo(
    () => [...library.local, ...library.unsplash].sort((a, b) => b.time - a.time),
    [library.local, library.unsplash]
  );

  const visibleItems = useMemo(() => {
    if (filter === 'local') return library.local;
    if (filter === 'unsplash') return library.unsplash;
    return allItems;
  }, [filter, library.local, library.unsplash, allItems]);

  const itemsByKey = useMemo(() => new Map(allItems.map((item) => [item.key, item])), [allItems]);

  const cachedIds = useMemo(
    () => new Set(library.unsplash.map((item) => item.ref.id)),
    [library.unsplash]
  );

  // Selection is keyed by `${source}:${id}`; drop keys whose records no longer exist.
  const selectedKeys = useMemo(
    () => new Set([...selected].filter((key) => itemsByKey.has(key))),
    [selected, itemsByKey]
  );

  const activeKey = active ? refKey(active) : null;
  const counts = { all: allItems.length, local: library.local.length, unsplash: library.unsplash.length };

  // ── Local import ─────────────────────────────────────────────────────────
  const handleImport = async (files) => {
    if (importControllerRef.current || files.length === 0) return;
    const controller = new AbortController();
    importControllerRef.current = controller;
    setImportState({
      ...IDLE_IMPORT,
      running: true,
      progress: { done: 0, total: files.length, current: '' }
    });
    setAnnouncement(`Importing ${plural(files.length, 'image')}.`);

    try {
      const result = await importLocalFiles(files, {
        signal: controller.signal,
        onProgress: ({ done, total, current }) => {
          setImportState((prev) => ({
            ...prev,
            progress: { done, total, current: current || '' }
          }));
        }
      });
      const summary = {
        imported: result?.imported || [],
        duplicates: result?.duplicates || [],
        failed: result?.failed || [],
        cancelled: Boolean(result?.cancelled)
      };
      setImportState({ ...IDLE_IMPORT, summary });
      setAnnouncement(
        `Import ${summary.cancelled ? 'cancelled' : 'finished'}: ${summary.imported.length} imported, `
        + `${plural(summary.duplicates.length, 'duplicate')}, ${summary.failed.length} failed.`
      );
    } catch (err) {
      if (isAbortError(err)) {
        setImportState({ ...IDLE_IMPORT, summary: { imported: [], duplicates: [], failed: [], cancelled: true } });
        setAnnouncement('Import cancelled.');
      } else {
        console.error('Import failed:', err);
        const message = describeWallpaperError(err) || 'Import failed. Please try again.';
        setImportState({ ...IDLE_IMPORT, error: message });
        setAnnouncement(message);
      }
    } finally {
      importControllerRef.current = null;
      refreshLibrary();
    }
  };

  const handleCancelImport = () => {
    if (!importControllerRef.current) return;
    importControllerRef.current.abort();
    setImportState((prev) => ({ ...prev, cancelling: true }));
  };

  // ── Gallery interactions ─────────────────────────────────────────────────
  const toggleSelected = (key) => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((k) => itemsByKey.has(k)));
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleCardClick = async (item) => {
    if (deleting) return;
    if (selectionMode) {
      toggleSelected(item.key);
      return;
    }
    if (sameRef(active, item.ref)) return;
    setGalleryNotice(null);
    try {
      await setActiveWallpaper(item.ref);
      setActive(item.ref);
    } catch (err) {
      console.error('Failed to set wallpaper:', err);
      const message = describeWallpaperError(err);
      setGalleryNotice({ tone: 'error', text: message });
      setAnnouncement(message);
    }
  };

  const exitSelection = () => {
    setSelectionMode(false);
    setSelected(new Set());
  };

  const handleConfirmDelete = async () => {
    if (deletingRef.current) return;
    const refs = [...selectedKeys].map((key) => itemsByKey.get(key)?.ref).filter(Boolean);
    if (refs.length === 0) {
      setConfirmingDelete(false);
      return;
    }
    deletingRef.current = true;
    setDeleting(true);
    try {
      const result = await deleteWallpapers(refs);
      const deletedCount = result?.deleted ? result.deleted.length : refs.length;
      const removedActive = refs.some((ref) => sameRef(ref, active));
      let text = `Deleted ${plural(deletedCount, 'wallpaper')}.`;
      if (removedActive) {
        text += result?.newActive
          ? ' Another wallpaper is now active.'
          : ' No wallpapers are left, so the default background is shown.';
      }
      setGalleryNotice({ tone: 'success', text });
      setAnnouncement(text);
      setSelectionMode(false);
      setSelected(new Set());
    } catch (err) {
      console.error('Failed to delete wallpapers:', err);
      const message = describeWallpaperError(err) || 'Couldn’t delete the selected wallpapers.';
      setGalleryNotice({ tone: 'error', text: message });
      setAnnouncement(message);
    } finally {
      deletingRef.current = false;
      setDeleting(false);
      setConfirmingDelete(false);
      setActive(getActiveWallpaper());
      refreshLibrary();
    }
  };

  const source = settings.source === 'unsplash' ? 'unsplash' : 'local';
  const liveMessage = importState.running && !importState.cancelling
    ? `Importing ${importState.progress.done} of ${importState.progress.total}`
    : announcement;
  const selectedCount = selectedKeys.size;

  return (
    <div className="settings-tab-pane wp-root">
      <div className="settings-group-card-title">Wallpaper Source</div>
      <div className="settings-group-card">
        <div className="settings-row wp-row-wrap">
          <div className="wp-row-text">
            <span className="settings-label">Source</span>
            <span className="wp-hint">Switching sources keeps every saved wallpaper.</span>
          </div>
          <SegmentedControl
            label="Wallpaper source"
            options={SOURCE_OPTIONS}
            value={source}
            onChange={(value) => updateSettings({ source: value })}
          />
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={source}
          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -4 }}
          transition={{ duration: reduceMotion ? 0 : 0.18, ease: 'easeOut' }}
        >
          {source === 'local' ? (
            <LocalImportPanel
              importState={importState}
              onImport={handleImport}
              onCancel={handleCancelImport}
              onDismissSummary={() => setImportState((prev) => ({ ...prev, summary: null, error: '' }))}
            />
          ) : unsplashConfigured ? (
            <UnsplashPanel
              settings={settings}
              onSettingsChange={updateSettings}
              quota={quota}
              online={online}
              cachedIds={cachedIds}
              activeKey={activeKey}
              onAnnounce={announce}
            />
          ) : (
            <div className="wp-panel">
              <div className="settings-group-card-title">Unsplash</div>
              <div className="settings-group-card wp-setup">
                <span className="wp-setup-icon" aria-hidden="true">🔑</span>
                <h4>Unsplash isn’t set up</h4>
                <p>
                  This build has no Unsplash proxy. Point it at your deployed proxy in the <code>.env</code> file:
                </p>
                <pre className="wp-code">VITE_UNSPLASH_PROXY_URL=https://your-app.vercel.app/api/unsplash</pre>
                <p>
                  Then rebuild the extension. Your saved Unsplash photos stay in the library below.
                </p>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <WallpaperGallery
        items={visibleItems}
        counts={counts}
        filter={filter}
        onFilterChange={setFilter}
        activeKey={activeKey}
        selectionMode={selectionMode}
        selectedKeys={selectedKeys}
        onEnterSelection={() => {
          setGalleryNotice(null);
          setSelectionMode(true);
        }}
        onExitSelection={exitSelection}
        onSelectAll={() => setSelected(new Set(visibleItems.map((item) => item.key)))}
        onClearSelection={() => setSelected(new Set())}
        onRequestDelete={() => selectedCount > 0 && setConfirmingDelete(true)}
        onCardClick={handleCardClick}
        deleting={deleting}
        loaded={library.loaded}
        loadError={library.error}
        notice={galleryNotice}
        dropEnabled={source === 'local' && !importState.running}
        onDropFiles={handleImport}
      />

      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete ${plural(selectedCount, 'wallpaper')}?`}
          message={
            `${selectedCount === 1 ? 'This wallpaper' : `These ${selectedCount} wallpapers`} will be removed from this browser. `
            + (activeKey && selectedKeys.has(activeKey) ? 'The active wallpaper is included and will be replaced. ' : '')
            + 'This can’t be undone.'
          }
          confirmLabel="Delete"
          destructive
          busy={deleting}
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}

      <div className="wp-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {liveMessage}
      </div>
    </div>
  );
}
