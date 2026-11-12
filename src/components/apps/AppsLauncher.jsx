import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import DockAppIcon from '../dock/DockAppIcon';
import MacAppIcon from '../icons/MacAppIcon';
import { useFavicons } from '../../libs/favicons/useFavicons';
import { domainOf } from '../../libs/dock/bookmarks';
import { openNotes } from '../../libs/notes/notesEvents';
import { openNews } from '../../libs/news/newsEvents';
import { openAtmosphere } from '../../libs/ambience/store.js';
import '../../styles/apps-launcher.css';

// Apps, as in macOS 26 (it took Launchpad's place): every app and bookmark in a full-screen
// grid over the blurred desktop, with a search field and All / Apps / Bookmarks. Opened from
// the Dock's Apps icon, F4 or iWeb → Apps (the `apps:toggle` event). Type to filter, arrows
// to move, Enter to open; Escape or a click on empty space closes it.

export const APPS_TOGGLE = 'apps:toggle';
const OUT_MS = 200;
const FALLBACK_ICON = 'https://ik.imagekit.io/026k2i7ys/iWeb%20Favicon.svg?updatedAt=1700227200100';
const settings = (tab) => window.dispatchEvent(new CustomEvent('settings:open', tab ? { detail: { tab } } : undefined));

const BUILT_IN = [
  { id: 'notes', name: 'Notes', icon: <DockAppIcon name="notes" />, open: () => openNotes(), keywords: 'tasks todo' },
  { id: 'music', name: 'Music', icon: <DockAppIcon name="music" />, open: () => window.dispatchEvent(new Event('music:open')), keywords: 'songs player' },
  { id: 'markets', name: 'Markets', icon: <DockAppIcon name="markets" />, open: () => window.dispatchEvent(new CustomEvent('markets:open')), keywords: 'stocks nifty sensex gold' },
  { id: 'news', name: 'News', icon: <DockAppIcon name="news" />, open: () => openNews(), keywords: 'headlines' },
  { id: 'atmosphere', name: 'Atmosphere', icon: <DockAppIcon name="atmosphere" />, open: () => openAtmosphere(), keywords: 'ambience ambient sound rain focus sleep relax music' },
  { id: 'spotlight', name: 'Spotlight', icon: <MacAppIcon name="spotlight" />, open: (a) => a.openSpotlight(), keywords: 'search' },
  { id: 'wallpaper', name: 'Wallpapers', icon: <DockAppIcon name="bg" />, open: () => settings('wallpaper'), keywords: 'background unsplash' },
  { id: 'widgets', name: 'Widgets', icon: <MacAppIcon name="clock" />, open: () => settings('widgets'), keywords: 'gallery desktop' },
  { id: 'settings', name: 'Settings', icon: <DockAppIcon name="settings" />, open: () => settings(), keywords: 'preferences system' },
];

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'apps', label: 'Apps' },
  { id: 'bookmarks', label: 'Bookmarks' },
];

function BookmarkIcon({ bookmark, cached }) {
  const [broken, setBroken] = useState(false);
  const src = broken ? FALLBACK_ICON : cached || bookmark.favicon || FALLBACK_ICON;
  return (
    <span className="al-favicon">
      <img src={src} alt="" draggable={false} onError={() => setBroken(true)} />
    </span>
  );
}

function Launcher({ bookmarks, actions, closing, onClose }) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('all');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const gridRef = useRef(null);
  const cached = useFavicons(bookmarks.map((b) => domainOf(b.url)));

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (name, extra = '') => !q || name.toLowerCase().includes(q) || extra.toLowerCase().includes(q);
    const apps = tab === 'bookmarks' ? [] : BUILT_IN.filter((a) => match(a.name, a.keywords)).map((a) => ({
      key: `app:${a.id}`, name: a.name, icon: a.icon, open: () => a.open(actions),
    }));
    const marks = tab === 'apps' ? [] : bookmarks.filter((b) => match(b.websiteName, domainOf(b.url))).map((b) => ({
      key: `bm:${b.websiteName}`,
      name: b.websiteName,
      icon: <BookmarkIcon bookmark={b} cached={cached[domainOf(b.url)]} />,
      open: () => window.open(b.url, '_blank', 'noopener,noreferrer'),
    }));
    const add = tab !== 'apps' && !q
      ? [{ key: 'add', name: 'Add App', icon: <span className="al-add" aria-hidden="true">+</span>, open: () => window.dispatchEvent(new Event('dock:add-app')) }]
      : [];
    return [...apps, ...marks, ...add];
  }, [query, tab, bookmarks, cached, actions]);

  // Keep the highlight on a real item as the list changes (adjusted while rendering).
  const [shownFor, setShownFor] = useState(items);
  if (shownFor !== items) {
    setShownFor(items);
    if (active >= items.length) setActive(Math.max(0, items.length - 1));
  }

  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const run = (item) => {
    onClose();
    // After the launcher has started closing, so a window opening isn't covered.
    requestAnimationFrame(() => item.open());
  };

  const columns = () => {
    const grid = gridRef.current;
    const first = grid?.firstElementChild;
    if (!grid || !first) return 1;
    return Math.max(1, Math.round(grid.clientWidth / first.getBoundingClientRect().width));
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (query) setQuery('');
      else onClose();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (items[active]) run(items[active]);
      return;
    }
    const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns(), ArrowUp: -columns() }[e.key];
    // Up / down always move through the grid; left / right do when there's no text to move in.
    if (step && (vertical || !query || e.target !== inputRef.current)) {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, Math.max(0, i + step)));
    }
  };

  useEffect(() => {
    gridRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // Apps is on top of everything: its keys come first, before any open app window's.
  const keyRef = useRef(onKeyDown);
  useEffect(() => {
    keyRef.current = onKeyDown;
  });
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F4') return; // the toggle (AppsLauncher)
      keyRef.current(e);
      if (['Escape', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div
      className={`al${closing ? ' is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Apps"
      onPointerDown={(e) => {
        // Empty space closes it, as in macOS.
        if (!e.target.closest('.al-item, .al-search, .al-tabs')) onClose();
      }}
    >
      <div className="al-top">
        <label className="al-search">
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="6.8" cy="6.8" r="4.8" /><path d="m10.4 10.4 4 4" /></svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search"
            aria-label="Search apps"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
          />
        </label>
        <div className="al-tabs" role="tablist" aria-label="Show">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`al-tab${tab === t.id ? ' is-active' : ''}`}
              onClick={() => {
                setTab(t.id);
                setActive(0);
                inputRef.current?.focus({ preventScroll: true });
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="al-scroll">
        {items.length === 0 ? (
          <p className="al-none">No Results</p>
        ) : (
          <ul ref={gridRef} className="al-grid">
            {items.map((item, i) => (
              <li key={item.key} className="al-cell" style={{ '--i': i }}>
                <button
                  type="button"
                  className={`al-item${i === active ? ' is-active' : ''}`}
                  onClick={() => run(item)}
                  onPointerEnter={() => setActive(i)}
                >
                  <span className="al-icon">{item.icon}</span>
                  <span className="al-name">{item.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function AppsLauncher({ bookmarks, actions }) {
  const [state, setState] = useState('closed'); // closed | open | closing
  const timer = useRef(0);
  const close = () => {
    setState((s) => (s === 'open' ? 'closing' : s));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState((s) => (s === 'closing' ? 'closed' : s)), OUT_MS);
  };
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  useEffect(() => {
    const toggle = () => {
      clearTimeout(timer.current);
      setState((s) => {
        if (s === 'open') {
          timer.current = setTimeout(() => setState((x) => (x === 'closing' ? 'closed' : x)), OUT_MS);
          return 'closing';
        }
        return 'open';
      });
    };
    // F4 opens it, as Launchpad's key did (not in text fields).
    const onKey = (e) => {
      if (e.key !== 'F4' || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener(APPS_TOGGLE, toggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(APPS_TOGGLE, toggle);
      window.removeEventListener('keydown', onKey);
      clearTimeout(timer.current);
    };
  }, []);

  if (state === 'closed') return null;
  return <Launcher bookmarks={bookmarks} actions={actions} closing={state === 'closing'} onClose={() => closeRef.current()} />;
}
