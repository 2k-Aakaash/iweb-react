import React, { useState, useEffect, useLayoutEffect, useRef, Suspense } from 'react';
import Background from './components/Background';
import Clock from './components/Clock';
import Quote from './components/Quote';
import DesktopModes from './components/controlcenter/DesktopModes';
import TimerBubble from './components/controlcenter/TimerBubble';
import { markBootReady } from './libs/boot/bootReveal';
import Dock from './components/Dock';
import SmartStack from './components/widgets/SmartStack';
import { STACK_WIDGETS } from './components/widgets/stackWidgets';
import Music from './components/Music';
import Notes from './components/Notes';
import { SearchBar } from './search/components/SearchBar';
import UpdateNotice from './components/update/UpdateNotice';
import { openIwebDB } from './libs/wallpaper/db';
import { OPEN_EVENT as MARKETS_OPEN_EVENT } from './libs/markets/marketService';
import { NEWS_OPEN_EVENT } from './libs/news/newsEvents';
import NewsWidget from './components/news/NewsWidget';
import DesktopItem from './components/desktop/DesktopItem';
import EditWidgetsLayer from './components/desktop/EditWidgetsLayer';
import ContextMenu from './components/desktop/ContextMenu';
import MenuBar from './components/menubar/MenuBar';
import { snapToSlots, useDesktop } from './libs/desktop/layoutStore';
import { setDesktopTopInset } from './libs/desktop/layout';
import { desktopInsetFor, useMenubarMode } from './libs/menubar/menubarPrefs';
import { useFullscreen } from './components/menubar/status';

// The Markets and News apps are loaded on first open, so they add nothing to the new-tab
// bundle. If a chunk can't be fetched (offline, or a page left open across a deploy) it logs
// and closes instead of taking the whole page down.
const MarketsModal = React.lazy(() => import('./components/markets/MarketsModal').catch((err) => {
  console.error('Failed to load the Markets app:', err);
  return { default: AppUnavailable };
}));
const NewsModal = React.lazy(() => import('./components/news/NewsModal').catch((err) => {
  console.error('Failed to load the News app:', err);
  return { default: AppUnavailable };
}));

// Spotlight (with Framer Motion, Radix, the search database, engines and worker) mounts the
// first time it opens; its code is fetched when the browser is idle, so Ctrl K stays instant.
const loadSpotlight = () => import('./search/components/SearchResult');
const SearchResult = React.lazy(() => loadSpotlight().then((m) => ({ default: m.SearchResult })).catch((err) => {
  console.error('Failed to load Spotlight:', err);
  return { default: ({ onClose }) => <AppUnavailable setOpen={() => onClose?.()} /> };
}));

// Settings (its panes, the wallpaper library, Framer Motion…) mounts on first open, on the pane
// that was asked for; its code is also fetched once the desktop is idle.
const loadSettings = () => import('./components/SettingsModal');
const SettingsModal = React.lazy(() => loadSettings().catch((err) => {
  console.error('Failed to load Settings:', err);
  return { default: ({ onClose }) => <AppUnavailable setOpen={() => onClose?.()} /> };
}));

// The Creator widgets (YouTube and Instagram analytics) load only when on the desktop: until
// someone adds one, none of their code is fetched. DesktopItem renders nothing for a hidden
// item, so the lazy import never starts for them.
const YouTubeWidget = React.lazy(() => import('./components/creator/YouTubeWidget').catch((err) => {
  console.error('Failed to load the YouTube widget:', err);
  return { default: () => null };
}));

// Holds the widget's slot while its code loads, so nothing else is placed on top of it.
const widgetSlot = <div aria-hidden="true" style={{ width: 'var(--widget-w)', height: 'var(--widget-h)' }} />;

const whenIdle = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500));

function AppUnavailable({ setOpen }) {
  useEffect(() => {
    setOpen?.(false);
  }, [setOpen]);
  return null;
}

export default function App() {
  const [customName, setCustomName] = useState('');
  const [clockFont, setClockFont] = useState('');
  const [clockColor, setClockColor] = useState('');
  const [showMusicLibrary, setShowMusicLibrary] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchLoaded, setSearchLoaded] = useState(false);
  if (isSearchOpen && !searchLoaded) setSearchLoaded(true); // mounted from its first open on
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState(null); // set on first open: then it's mounted
  const [marketsOpen, setMarketsOpen] = useState(false);
  const [marketsLoaded, setMarketsLoaded] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);
  const [newsLoaded, setNewsLoaded] = useState(false);
  const [marketsSymbol, setMarketsSymbol] = useState(null);

  const changeBgRef = useRef(null);
  const desktop = useDesktop();
  // What the desktop's right-click menu can do.
  const desktopActions = {
    openSettings: (tab) => window.dispatchEvent(new CustomEvent('settings:open', { detail: { tab } })),
    nextWallpaper: () => changeBgRef.current?.(),
    openSpotlight: () => setIsSearchOpen(true),
    openWidgetGallery: () => window.dispatchEvent(new CustomEvent('settings:open', { detail: { tab: 'widgets' } })),
  };
  // Ref that Background.jsx will expose to trigger its file input (upload new BG)
  const changeBgUploadRef = useRef(null);

  const [bookmarks, setBookmarks] = useState([]);

  // Initial load of customization details
  useEffect(() => {
    const storedName = localStorage.getItem('customName');
    if (storedName) setCustomName(storedName);

    const storedFont = localStorage.getItem('selectedFont');
    if (storedFont) setClockFont(storedFont);

    const storedBookmarks = JSON.parse(localStorage.getItem('bookmarks')) || [];
    storedBookmarks.sort((a, b) => (a.order || 0) - (b.order || 0));
    setBookmarks(storedBookmarks);

    // Load custom fonts from IndexedDB
    openIwebDB().then((db) => {
      if (!db.objectStoreNames.contains('custom_fonts')) return;
      const tx = db.transaction('custom_fonts', 'readonly');
      const store = tx.objectStore('custom_fonts');
      const req = store.getAll();
      req.onsuccess = async (ev) => {
        const fonts = ev.target.result || [];
        for (const font of fonts) {
          try {
            const fontUrl = URL.createObjectURL(font.blob);
            const fontFace = new FontFace(font.family, `url(${fontUrl})`);
            await fontFace.load();
            document.fonts.add(fontFace);
            console.log(`Loaded custom font: ${font.name} (${font.family})`);
          } catch (err) {
            console.error(`Failed to load custom font ${font.name}:`, err);
          }
        }
        // Force refresh state in case the custom font was active
        if (storedFont) {
          setClockFont('');
          setTimeout(() => setClockFont(storedFont), 50);
        }
      };
    }).catch((err) => {
      console.error('Failed to open iWebDB for custom fonts:', err);
    });
  }, []);

  // The menu bar's room on the desktop (none when it hides there: Settings → Appearance).
  // Widgets line up on the slot grid below it once the desktop is laid out, and again when
  // that room changes (also: arrangements from before slots, or from another tab).
  const menubarMode = useMenubarMode();
  const fullscreen = useFullscreen();
  const desktopInset = desktopInsetFor(menubarMode, { fullscreen });
  useLayoutEffect(() => {
    setDesktopTopInset(desktopInset);
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(snapToSlots);
    });
    return () => cancelAnimationFrame(frame);
  }, [desktopInset]);

  // Rendered: one of the two things the start-up veil waits for (the other is the wallpaper).
  useEffect(() => {
    markBootReady('app');
  }, []);

  // Spotlight's code, fetched once the desktop is idle.
  useEffect(() => {
    whenIdle(() => {
      loadSpotlight().catch(() => {});
      loadSettings().catch(() => {});
    });
  }, []);

  // Global hotkey Ctrl+K / Cmd+K listener
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Listen to music open event to trigger library modal
  useEffect(() => {
    const handleOpenMusic = () => {
      setShowMusicLibrary(true);
    };
    const handleOpenSettings = (e) => {
      // The first open mounts Settings on this pane; later ones it handles itself.
      setSettingsTab((tab) => tab ?? (e.detail?.tab || 'general'));
      setShowSettings(true);
    };
    window.addEventListener('music:open', handleOpenMusic);
    window.addEventListener('settings:open', handleOpenSettings);
    window.addEventListener('music:openSettings', handleOpenMusic);
    return () => {
      window.removeEventListener('music:open', handleOpenMusic);
      window.removeEventListener('music:openSettings', handleOpenMusic);
      window.removeEventListener('settings:open', handleOpenSettings);
    };
  }, []);

  // The Markets card and Spotlight open the Markets app, optionally on a symbol.
  useEffect(() => {
    const handleOpenMarkets = (e) => {
      // Restoring from the Dock keeps the symbol it was showing.
      if (!e.detail?.restore) setMarketsSymbol(e.detail?.symbol || null);
      setMarketsLoaded(true);
      setMarketsOpen(true);
    };
    window.addEventListener(MARKETS_OPEN_EVENT, handleOpenMarkets);
    return () => window.removeEventListener(MARKETS_OPEN_EVENT, handleOpenMarkets);
  }, []);

  // The News widget and the News Dock icon open the News app.
  useEffect(() => {
    const handleOpenNews = () => {
      setNewsLoaded(true);
      setNewsOpen(true);
    };
    window.addEventListener(NEWS_OPEN_EVENT, handleOpenNews);
    return () => window.removeEventListener(NEWS_OPEN_EVENT, handleOpenNews);
  }, []);


  const handleClockColorChange = (color) => {
    setClockColor(color);
  };

  return (
    <>
      {/* 0. The macOS menu bar: the front app's menus, status, Control Center and the clock */}
      <MenuBar actions={desktopActions} />
      {/* Control Center's effects on the page (Focus, Widgets, Display, Night Shift) and the
          running timer beside the Dynamic Island */}
      <DesktopModes />
      <TimerBubble />

      {/* 1. Dynamic Island & Music System */}
      <Music 
        showModal={showMusicLibrary} 
        setShowModal={setShowMusicLibrary} 
      />

      {/* 2. The desktop: movable, resizable items (right-click → Edit Widgets). By default the
          Smart Stack sits top-right, News top-left, and the clock and search in the middle. */}
      {desktop.layout.stack.pages.length > 0 && (
        <DesktopItem id="stack">
          <SmartStack size={desktop.layout.stack.size} pages={desktop.layout.stack.pages} />
        </DesktopItem>
      )}
      {/* Stack widgets placed on their own (right-click → Detach, or Settings → Widgets). */}
      {Object.values(STACK_WIDGETS).map(({ id, Component }) => (
        <DesktopItem key={id} id={id}>
          <Component active />
        </DesktopItem>
      ))}
      <DesktopItem id="news">
        <NewsWidget size={desktop.layout.news.size} />
      </DesktopItem>
      <DesktopItem id="youtube">
        <Suspense fallback={widgetSlot}>
          <YouTubeWidget size={desktop.layout.youtube.size} />
        </Suspense>
      </DesktopItem>
      {/* Instagram Analytics is in development (ITEMS.instagram.inDevelopment): never placed. */}

      {/* 3. The clock, the quote under it, and the Spotlight search bar */}
      <DesktopItem id="clock">
        <Clock clockFont={clockFont} />
      </DesktopItem>
      <DesktopItem id="quote">
        <Quote customName={customName} />
      </DesktopItem>
      <DesktopItem id="search">
        <SearchBar onOpenSearch={() => setIsSearchOpen(true)} />
      </DesktopItem>
      <EditWidgetsLayer />
      <ContextMenu actions={desktopActions} />

      {/* 4. Bottom Dock Navigation */}
      <Dock 
        bookmarks={bookmarks}
        setBookmarks={setBookmarks}
        onChangeBg={() => changeBgRef.current?.()}
        onOpenNotes={() => window.dispatchEvent(new CustomEvent('notes:open'))}
        onOpenSettings={() => window.dispatchEvent(new CustomEvent('settings:open'))}
        onOpenMusicLibrary={() => setShowMusicLibrary(true)}
      />

      {/* 5. Notes Section */}
      <Notes />

      {/* 6. Background and Customization Controllers */}
      <Background 
        customName={customName}
        clockFont={clockFont}
        onChangeName={setCustomName}
        onChangeFont={setClockFont}
        onClockColorChange={handleClockColorChange}
        onChangeBgRef={changeBgRef}
        onChangeBgUploadRef={changeBgUploadRef}
        onOpenMusicLibrary={() => setShowMusicLibrary(true)}
      />

      {searchLoaded && (
        <Suspense fallback={null}>
          <SearchResult isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
        </Suspense>
      )}

      <UpdateNotice />

      {settingsTab && (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={showSettings}
            onClose={() => setShowSettings(false)}
            customName={customName}
            setCustomName={setCustomName}
            clockFont={clockFont}
            setClockFont={setClockFont}
            bookmarks={bookmarks}
            setBookmarks={setBookmarks}
            initialTab={settingsTab}
          />
        </Suspense>
      )}

      {/* Loaded on first open, then kept: it animates in and out (genie) and keeps its
          state while minimized to the Dock, like the other app windows. */}
      {marketsLoaded && (
        <Suspense fallback={null}>
          <MarketsModal open={marketsOpen} setOpen={setMarketsOpen} initialSymbol={marketsSymbol} />
        </Suspense>
      )}

      {newsLoaded && (
        <Suspense fallback={null}>
          <NewsModal open={newsOpen} setOpen={setNewsOpen} />
        </Suspense>
      )}

      <style>{`
        #clock {
          color: ${clockColor || 'inherit'};
          transition: color 200ms ease-in-out;
        }
      `}</style>
    </>
  );
}
