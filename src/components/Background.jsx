import { useEffect, useRef } from 'react';
import { getWallpaperSettings, getActiveWallpaper, setActiveWallpaper } from '../libs/wallpaper/settings';
import { subscribe, broadcast } from '../libs/wallpaper/sync';
import { listLocal, listUnsplash, getWallpaperRecord, addLocalRecord, findLocalByHash } from '../libs/wallpaper/repository';
import { ACCEPTED_LOCAL_TYPES, makeThumbnail, sha256Hex } from '../libs/wallpaper/imageLoader';
import { importLocalFiles } from '../libs/wallpaper/importManager';
import { changeUnsplashBackground } from '../libs/wallpaper/discovery';
import { showWallpaper, showDefaultWallpaper } from '../libs/wallpaper/wallpaperRenderer';

const DEFAULT_KEY = 'default';

const refKey = (ref) => (ref ? `${ref.source}:${ref.id}` : null);

const dataURLtoBlob = (dataurl) => {
  try {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  } catch (e) {
    console.error("Failed base64 conversion", e);
    return null;
  }
};

// One-time migration of the legacy localStorage `backgroundImages` (base64)
// into the background_images store. Shared promise so StrictMode's double
// mount (or a re-mount) never migrates twice.
let legacyMigration = null;

function migrateLegacyBackgrounds() {
  if (!legacyMigration) {
    legacyMigration = (async () => {
      const legacyData = localStorage.getItem('backgroundImages');
      if (!legacyData) return;

      let legacyImages;
      try {
        legacyImages = JSON.parse(legacyData);
      } catch (err) {
        console.error("Failed legacy migration:", err);
        localStorage.removeItem('backgroundImages');
        return;
      }
      if (!Array.isArray(legacyImages) || legacyImages.length === 0) {
        localStorage.removeItem('backgroundImages');
        return;
      }

      console.log(`Migrating ${legacyImages.length} legacy images to IndexedDB...`);
      let added = 0;
      let failed = 0;
      for (let i = 0; i < legacyImages.length; i++) {
        const blob = typeof legacyImages[i] === 'string' ? dataURLtoBlob(legacyImages[i]) : null;
        if (!blob) continue; // unreadable entry: nothing to keep
        try {
          const hash = await sha256Hex(blob);
          if (await findLocalByHash(hash)) continue; // already migrated on an earlier attempt
          const thumb = await makeThumbnail(blob).catch(() => null);
          await addLocalRecord({
            blob,
            thumb,
            name: `Wallpaper ${i + 1}`,
            type: blob.type,
            size: blob.size,
            hash,
          });
          added++;
        } catch (err) {
          failed++;
          console.error("Failed legacy migration:", err);
        }
      }

      // Keep the legacy data if a write failed so the next load can retry
      // (hash dedupe prevents duplicates).
      if (failed === 0) localStorage.removeItem('backgroundImages');
      if (added > 0) broadcast('library-changed');
    })().catch((err) => {
      console.error("Failed legacy migration:", err);
    });
  }
  return legacyMigration;
}

function unsplashErrorMessage(err) {
  switch (err?.code) {
    case 'DAILY_LIMIT':
      return 'Daily Unsplash limit reached and no saved wallpapers match your topics. New photos will be available after midnight.';
    case 'NOT_CONFIGURED':
      return 'Unsplash is not configured. Add an access key to use Unsplash wallpapers.';
    case 'UNAUTHORIZED':
      return 'Unsplash rejected the access key. Please check the configuration.';
    case 'RATE_LIMITED':
      return 'Unsplash is receiving too many requests right now. Please try again later.';
    case 'OFFLINE':
    case 'NETWORK':
      return 'You appear to be offline and there are no saved Unsplash wallpapers to show.';
    case 'INVALID_QUERY':
      return 'No Unsplash photos were found for your topics or keyword.';
    default:
      return 'Could not load a new wallpaper from Unsplash. Your current wallpaper was kept.';
  }
}

// Props kept for App.jsx compatibility: customName, clockFont, onChangeName,
// onChangeFont and onOpenMusicLibrary are accepted but not used here.
export default function Background({
  onClockColorChange,
  onChangeBgRef,
  onChangeBgUploadRef,
}) {
  const fileInputRef = useRef(null);
  const colorCallbackRef = useRef(onClockColorChange);
  // What the renderer currently shows: 'local:<id>' | 'unsplash:<photoId>' | 'default' | null
  const displayedKeyRef = useRef(null);
  // Key of the most recent render request (may still be in flight).
  const requestedKeyRef = useRef(null);
  // Bumped by every render request; older requests stop at their next await.
  const renderSeqRef = useRef(0);
  // True while this component persists its own fallback, so the synchronous
  // same-tab 'active-changed' echo is ignored.
  const persistingRef = useRef(false);

  useEffect(() => {
    colorCallbackRef.current = onClockColorChange;
  }, [onClockColorChange]);

  useEffect(() => {
    let disposed = false;
    const onColor = (hex) => {
      if (!disposed) colorCallbackRef.current?.(hex);
    };

    const persistActive = (ref) => {
      if (refKey(getActiveWallpaper()) === refKey(ref)) return;
      persistingRef.current = true;
      try {
        setActiveWallpaper(ref);
      } finally {
        persistingRef.current = false;
      }
    };

    // True when `key` is on screen and no other render is pending.
    const isSettledOn = (key) => displayedKeyRef.current === key && requestedKeyRef.current === key;

    const display = async (ref) => {
      requestedKeyRef.current = refKey(ref);
      const ok = await showWallpaper(ref, { onColor });
      if (ok) displayedKeyRef.current = refKey(ref);
      return ok;
    };

    const displayDefault = async () => {
      if (isSettledOn(DEFAULT_KEY)) return true;
      requestedKeyRef.current = DEFAULT_KEY;
      const ok = await showDefaultWallpaper({ onColor });
      if (ok) displayedKeyRef.current = DEFAULT_KEY;
      return ok;
    };

    // Fallback policy: first local wallpaper (id order) → most recent Unsplash
    // record → built-in default. The chosen ref is persisted.
    const showFallback = async (failedRef, isCurrent) => {
      const failedKey = refKey(failedRef);
      const candidates = [];
      try {
        const locals = (await listLocal())
          .filter((r) => refKey({ source: 'local', id: r.id }) !== failedKey)
          .sort((a, b) => a.id - b.id);
        if (locals.length) candidates.push({ source: 'local', id: locals[0].id });
      } catch (err) {
        console.warn('[wallpaper] Could not list local wallpapers:', err);
      }
      if (!isCurrent()) return;
      try {
        const remote = (await listUnsplash())
          .filter((r) => refKey({ source: 'unsplash', id: r.photoId }) !== failedKey);
        if (remote.length) candidates.push({ source: 'unsplash', id: remote[0].photoId });
      } catch (err) {
        console.warn('[wallpaper] Could not list Unsplash wallpapers:', err);
      }

      for (const candidate of candidates) {
        if (!isCurrent()) return;
        try {
          const ok = await display(candidate);
          if (!ok || !isCurrent()) return;
          persistActive(candidate);
          return;
        } catch (err) {
          console.warn(`[wallpaper] Fallback ${refKey(candidate)} failed:`, err);
        }
      }

      if (!isCurrent()) return;
      const ok = await displayDefault();
      if (ok && isCurrent()) persistActive(null);
    };

    const beginRender = () => {
      const seq = ++renderSeqRef.current;
      return () => !disposed && seq === renderSeqRef.current;
    };

    // Shows the persisted active wallpaper; falls back when it is missing or broken.
    const renderActive = async ({ fallbackWhenEmpty = true } = {}) => {
      const isCurrent = beginRender();
      const ref = getActiveWallpaper();

      if (!ref) {
        if (fallbackWhenEmpty) await showFallback(null, isCurrent);
        else await displayDefault();
        return;
      }
      if (isSettledOn(refKey(ref))) return;

      try {
        await display(ref);
        return;
      } catch (err) {
        console.warn(`[wallpaper] Could not show ${refKey(ref)}:`, err);
      }
      if (isCurrent()) await showFallback(ref, isCurrent);
    };

    // After a library change, make sure the active wallpaper still exists.
    const verifyActive = async () => {
      const ref = getActiveWallpaper();
      if (!ref) {
        await renderActive();
        return;
      }
      let record;
      try {
        record = await getWallpaperRecord(ref);
      } catch (err) {
        console.warn('[wallpaper] Could not verify the active wallpaper:', err);
        return;
      }
      if (disposed) return;
      if (!record) {
        const isCurrent = beginRender();
        await showFallback(ref, isCurrent);
      } else if (!isSettledOn(refKey(ref))) {
        await renderActive();
      }
    };

    const run = (task) => {
      task().catch((err) => console.warn('[wallpaper] Render failed:', err));
    };

    run(async () => {
      await migrateLegacyBackgrounds();
      if (!disposed) await renderActive();
    });

    const unsubscribe = subscribe(({ type }) => {
      if (disposed) return;
      if (type === 'active-changed') {
        if (persistingRef.current) return;
        // An explicit null (e.g. the last wallpaper was deleted) shows the default.
        run(() => renderActive({ fallbackWhenEmpty: false }));
      } else if (type === 'library-changed') {
        run(verifyActive);
      }
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  // Dock "Change BG" button: next Unsplash photo or next local wallpaper.
  useEffect(() => {
    if (!onChangeBgRef) return;
    onChangeBgRef.current = async () => {
      const settings = getWallpaperSettings();

      if (settings.source === 'unsplash') {
        try {
          const { record } = await changeUnsplashBackground({ settings });
          setActiveWallpaper({ source: 'unsplash', id: record.photoId });
        } catch (err) {
          console.warn('[wallpaper] Could not change the Unsplash wallpaper:', err);
          window.dispatchEvent(new CustomEvent('wallpaper:error', {
            detail: { message: unsplashErrorMessage(err), code: err?.code || null },
          }));
        }
        return;
      }

      try {
        const locals = (await listLocal()).sort((a, b) => a.id - b.id);
        if (locals.length === 0) return;
        const active = getActiveWallpaper();
        const idx = active?.source === 'local'
          ? locals.findIndex((r) => r.id === Number(active.id))
          : -1;
        const next = locals[(idx + 1) % locals.length];
        setActiveWallpaper({ source: 'local', id: next.id });
      } catch (err) {
        console.warn('[wallpaper] Could not change the local wallpaper:', err);
      }
    };
  }, [onChangeBgRef]);

  // Expose file upload trigger to parent (for dock Change BG button)
  useEffect(() => {
    if (onChangeBgUploadRef) {
      onChangeBgUploadRef.current = () => {
        if (fileInputRef.current) fileInputRef.current.click();
      };
    }
  }, [onChangeBgUploadRef]);

  const handleFileChange = async (e) => {
    const input = e.target;
    const files = Array.from(input.files || []);
    // Reset so selecting the same file again still fires `change`.
    input.value = '';
    if (files.length === 0) return;

    try {
      const result = await importLocalFiles(files);
      if (result.imported.length > 0) {
        setActiveWallpaper({ source: 'local', id: result.imported[result.imported.length - 1] });
      } else if (result.failed.length > 0) {
        const reasons = result.failed.map((f) => `${f.name}: ${f.reason}`).join('\n');
        alert(`Failed to add background image:\n${reasons}`);
      }
    } catch (err) {
      alert('Failed to save background image: ' + (err?.message || err));
    }
  };

  return (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept={ACCEPTED_LOCAL_TYPES.join(',')}
      onChange={handleFileChange}
      style={{ display: 'none' }}
      tabIndex={-1}
      aria-hidden="true"
    />
  );
}
