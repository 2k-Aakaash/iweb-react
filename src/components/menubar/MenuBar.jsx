import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { APP_TITLES, focusWindow, getController, useWindows } from '../../libs/window/windowRegistry';
import { setEditing } from '../../libs/desktop/layoutStore';
import { openNews } from '../../libs/news/newsEvents';
import { RELEASES_REPO } from '../../libs/updater/updater';
import { isMenubarHidden, useMenubarMode } from '../../libs/menubar/menubarPrefs';
import { useBattery, useFullscreen, useNow, useOnline } from './status';
import '../../styles/menubar.css';

// The macOS 26 menu bar across the top of iWeb. Left: the iWeb menu, the front app's name and
// its menus (File, Edit, View, the app's own, Window, Help); right: Spotlight, Wi-Fi, battery
// and the clock. The front app comes from the window registry (useMacWindow); with no window
// open it's the desktop ("iWeb"). When the front window is zoomed, its red / yellow / green
// buttons move here and the window fills the screen below the bar.
//
// Menus open on click and follow the pointer across titles while open, like macOS. The bar
// never takes focus from a text field (Edit → Copy / Paste act on it); arrows, Enter and
// Esc work while a menu is open.
//
// It hides as set in Settings → Appearance (menubarPrefs.js; by default on the desktop, when
// no app is open) and then slides in over the page when the pointer reaches the top edge.
// --menubar-space tells the page how much room it takes (0 while hidden).

const REVEAL_DELAY_MS = 90; // the pointer rests at the top edge this long before it slides in
const HIDE_DELAY_MS = 350;

const IWEB_ICON = 'https://ik.imagekit.io/026k2i7ys/iWeb%20Favicon.svg?updatedAt=1700227200100';
const REPO_URL = `https://github.com/${RELEASES_REPO}`;
const SEP = { type: 'separator' };

const dispatch = (name, detail) => window.dispatchEvent(new CustomEvent(name, detail ? { detail } : undefined));
const openSettings = (tab) => dispatch('settings:open', { tab });
const openLink = (url) => window.open(url, '_blank', 'noopener,noreferrer');

// Opening an app: its window's own control when it has one (restores a minimized window with
// the genie), else the event its owner listens for.
const OPENERS = {
  notes: () => dispatch('notes:open'),
  music: () => dispatch('music:open'),
  settings: () => openSettings('general'),
  markets: () => dispatch('markets:open'),
  news: () => openNews(),
};

function showApp(entry) {
  if (entry.state === 'open') {
    focusWindow(entry.app);
    return;
  }
  const controller = getController(entry.app);
  if (controller) controller.open();
  else OPENERS[entry.app]?.();
}

// ---- Edit menu: acts on the focused text field (the bar never takes focus) ----------------

function focusedField() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return el;
  if (el.tagName === 'INPUT' && /^(text|search|url|email|tel|password|number)$/i.test(el.type || 'text')) return el;
  return null;
}

function hasSelection(field) {
  if (field && typeof field.selectionStart === 'number') return field.selectionStart !== field.selectionEnd;
  const selection = window.getSelection?.();
  return Boolean(selection && !selection.isCollapsed && selection.toString());
}

function editItems() {
  const field = focusedField();
  const selected = hasSelection(field);
  const run = (command) => () => document.execCommand(command);
  return [
    { label: 'Undo', shortcut: 'Ctrl Z', disabled: !field, onSelect: run('undo') },
    { label: 'Redo', shortcut: 'Ctrl Y', disabled: !field, onSelect: run('redo') },
    SEP,
    { label: 'Cut', shortcut: 'Ctrl X', disabled: !field || !selected, onSelect: run('cut') },
    { label: 'Copy', shortcut: 'Ctrl C', disabled: !selected, onSelect: run('copy') },
    {
      label: 'Paste',
      shortcut: 'Ctrl V',
      disabled: !field || !navigator.clipboard?.readText,
      onSelect: () => {
        navigator.clipboard.readText()
          .then((text) => {
            if (text && document.activeElement === field) document.execCommand('insertText', false, text);
          })
          .catch(() => {}); // clipboard permission declined: Ctrl V still works
      },
    },
    { label: 'Select All', shortcut: 'Ctrl A', disabled: !field, onSelect: () => (field.select ? field.select() : document.execCommand('selectAll')) },
  ];
}

function fullScreenItem() {
  const on = Boolean(document.fullscreenElement);
  return {
    label: on ? 'Exit Full Screen' : 'Enter Full Screen',
    shortcut: 'F11',
    disabled: !document.fullscreenEnabled,
    onSelect: () => (on ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch?.(() => {}),
  };
}

const withSeparator = (items) => (items?.length ? [...items, SEP] : []);

/** The menus for the front app (or the desktop), built when the bar renders. */
function buildMenus(front, windows, actions) {
  const controller = front ? getController(front.app) : null;
  // An app's menus: a function, or a ref to one (filled in once its handlers exist).
  const getOwn = typeof controller?.menus === 'function' ? controller.menus : controller?.menus?.current;
  const own = (front && getOwn?.()) || {};
  const title = front ? front.title : 'iWeb';
  const running = windows.filter((w) => w.state !== 'closed');

  const iweb = {
    id: 'iweb',
    title: <img className="mb-logo-img" src={IWEB_ICON} alt="iWeb" draggable={false} />,
    label: 'iWeb',
    items: [
      { label: 'About iWeb', onSelect: () => openSettings('about') },
      SEP,
      { label: 'System Settings…', onSelect: () => openSettings('general') },
      { label: 'Widget Gallery…', onSelect: () => openSettings('widgets') },
      SEP,
      { label: 'Change Wallpaper…', onSelect: () => openSettings('wallpaper') },
      { label: 'Next Wallpaper', onSelect: actions.nextWallpaper },
      SEP,
      { label: 'Spotlight Search', shortcut: 'Ctrl K', onSelect: actions.openSpotlight },
    ],
  };

  const app = {
    id: 'app',
    title,
    items: front
      ? [
        { label: `About ${title}`, onSelect: () => openSettings('about') },
        SEP,
        { label: 'Settings…', onSelect: () => openSettings(front.app === 'music' ? 'music' : 'general') },
        SEP,
        { label: `Hide ${title}`, onSelect: () => controller?.minimize() },
        { label: `Quit ${title}`, onSelect: () => controller?.close() },
      ]
      : [
        { label: 'About iWeb', onSelect: () => openSettings('about') },
        SEP,
        { label: 'Settings…', onSelect: () => openSettings('general') },
      ],
  };

  const file = {
    id: 'file',
    title: 'File',
    items: front
      ? [...withSeparator(own.File), { label: 'Close Window', disabled: !controller, onSelect: () => controller.close() }]
      : Object.keys(OPENERS).filter((id) => id !== 'settings').map((id) => ({
        label: `Open ${APP_TITLES[id]}`,
        onSelect: () => showApp(windows.find((w) => w.app === id) || { app: id, state: 'closed' }),
      })),
  };

  const view = {
    id: 'view',
    title: 'View',
    items: front
      ? [
        ...withSeparator(own.View),
        fullScreenItem(),
        { label: front.maximized ? 'Exit Full Size' : 'Zoom', disabled: !controller, onSelect: () => controller.toggleMaximize() },
      ]
      : [
        { label: 'Edit Widgets…', onSelect: () => setEditing(true) },
        { label: 'Widget Gallery…', onSelect: () => openSettings('widgets') },
        SEP,
        fullScreenItem(),
      ],
  };

  // The app's own menus (e.g. Music → Controls) sit between View and Window, as on macOS.
  const extra = Object.entries(own)
    .filter(([name, items]) => !['File', 'View'].includes(name) && items?.length)
    .map(([name, items]) => ({ id: `app-${name}`, title: name, items }));

  const windowMenu = {
    id: 'window',
    title: 'Window',
    items: [
      { label: 'Minimize', disabled: !controller, onSelect: () => controller.minimize() },
      { label: front?.maximized ? 'Exit Full Size' : 'Zoom', disabled: !controller, onSelect: () => controller.toggleMaximize() },
      ...(running.length
        ? [SEP, ...running.map((w) => ({
          label: w.state === 'minimized' ? `${w.title} (minimized)` : w.title,
          checked: front?.app === w.app,
          onSelect: () => showApp(w),
        }))]
        : []),
    ],
  };

  const help = {
    id: 'help',
    title: 'Help',
    items: [
      { label: 'iWeb Help', onSelect: () => openLink(`${REPO_URL}#readme`) },
      { label: 'What’s New in iWeb', onSelect: () => openLink(`${REPO_URL}/releases`) },
      SEP,
      { label: 'Report an Issue…', onSelect: () => openLink(`${REPO_URL}/issues/new`) },
    ],
  };

  return [iweb, app, file, { id: 'edit', title: 'Edit', items: editItems() }, view, ...extra, windowMenu, help];
}

const isActionable = (item) => item && item.type !== 'separator' && item.type !== 'header' && !item.disabled;

function MenuPanel({ menu, left, active, setActive, onRun }) {
  const ref = useRef(null);
  const [shift, setShift] = useState(0);
  // Keep the panel on screen (menus near the right edge open leftwards).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const overflow = left + el.offsetWidth - (window.innerWidth - 8);
    setShift(overflow > 0 ? -overflow : 0);
  }, [left, menu.id]);

  return (
    <div ref={ref} className="mb-menu" role="menu" aria-label={menu.label || menu.title} style={{ left: left + shift }}>
      {menu.items.map((item, i) => {
        if (item.type === 'separator') return <div key={i} className="mb-menu-sep" role="separator" />;
        const radio = item.checked !== undefined;
        return (
          <button
            key={i}
            type="button"
            className={`mb-menu-item${active === i ? ' is-active' : ''}`}
            role={radio ? 'menuitemradio' : 'menuitem'}
            aria-checked={radio ? Boolean(item.checked) : undefined}
            aria-disabled={item.disabled || undefined}
            tabIndex={-1}
            onPointerMove={() => setActive(item.disabled ? -1 : i)}
            onPointerLeave={() => setActive(-1)}
            onClick={() => onRun(item)}
          >
            <span className="mb-menu-check" aria-hidden="true">{item.checked ? '✓' : ''}</span>
            <span className="mb-menu-label">{item.label}</span>
            {item.shortcut && <span className="mb-menu-shortcut">{item.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}

function TrafficLights({ front }) {
  const controller = getController(front.app);
  if (!controller) return null;
  return (
    <div className="mb-lights" role="group" aria-label={`${front.title} window`}>
      <button type="button" className="mb-light mb-light-close" aria-label={`Close ${front.title}`} title="Close" onClick={() => controller.close()} />
      <button type="button" className="mb-light mb-light-minimize" aria-label={`Minimize ${front.title}`} title="Minimize" onClick={() => controller.minimize()} />
      <button type="button" className="mb-light mb-light-zoom" aria-label="Exit full size" title="Exit Full Size" onClick={() => controller.toggleMaximize()} />
    </div>
  );
}

function StatusIcons({ onSpotlight }) {
  const now = useNow();
  const online = useOnline();
  const battery = useBattery();
  const date = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return (
    <div className="mb-right">
      {battery && (
        <span className="mb-status" title={`Battery ${Math.round(battery.level * 100)}%${battery.charging ? ', charging' : ''}`}>
          <svg viewBox="0 0 28 14" width="25" height="12" aria-hidden="true">
            <rect x="0.75" y="0.75" width="23.5" height="12.5" rx="3.5" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.5" />
            <rect x="3" y="3" width={Math.max(1.5, 19 * battery.level)} height="8" rx="1.6" fill={battery.level <= 0.2 && !battery.charging ? '#ff453a' : 'currentColor'} />
            <path d="M26 5v4" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span className="mb-sr">{`Battery ${Math.round(battery.level * 100)}%`}</span>
        </span>
      )}
      <span className="mb-status" title={online ? 'Online' : 'Offline'}>
        <svg viewBox="0 0 20 16" width="17" height="14" fill="currentColor" aria-hidden="true" style={{ opacity: online ? 1 : 0.4 }}>
          <path d="M10 13.6a1.6 1.6 0 1 1 0 .01z" />
          <path d="M5.9 10.3a5.8 5.8 0 0 1 8.2 0l-1.3 1.3a4 4 0 0 0-5.6 0z" />
          <path d="M3.1 7.5a9.8 9.8 0 0 1 13.8 0l-1.3 1.3a8 8 0 0 0-11.2 0z" />
          <path d="M.3 4.7a13.8 13.8 0 0 1 19.4 0l-1.3 1.3a12 12 0 0 0-16.8 0z" />
          {!online && <path d="M3 1l14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
        </svg>
        <span className="mb-sr">{online ? 'Online' : 'Offline'}</span>
      </span>
      <button type="button" className="mb-status mb-status-btn" aria-label="Spotlight Search" title="Spotlight Search (Ctrl K)" onClick={onSpotlight}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="6.8" cy="6.8" r="4.8" />
          <path d="m10.4 10.4 4 4" />
        </svg>
      </button>
      <time className="mb-clock" dateTime={now.toISOString()}>
        <span>{date}</span>
        <span>{time}</span>
      </time>
    </div>
  );
}

export default function MenuBar({ actions }) {
  const { windows, front } = useWindows();
  const [open, setOpen] = useState(null); // index of the open menu
  const [active, setActive] = useState(-1); // highlighted item in it (keyboard / pointer)
  const [left, setLeft] = useState(0); // the open menu's x, under its title
  const titleRefs = useRef([]);
  const barRef = useRef(null);

  // Auto-hide.
  const mode = useMenubarMode();
  const fullscreen = useFullscreen();
  const hidden = isMenubarHidden(mode, { appOpen: windows.some((w) => w.state === 'open'), fullscreen });
  const [revealed, setRevealed] = useState(false);
  const [wasHidden, setWasHidden] = useState(hidden);
  if (wasHidden !== hidden) {
    setWasHidden(hidden);
    setRevealed(false); // starts hidden each time it begins hiding
  }
  const hoverRef = useRef(false);
  const revealTimer = useRef(0);
  const reveal = (value, delay) => {
    clearTimeout(revealTimer.current);
    revealTimer.current = setTimeout(() => setRevealed(value), delay);
  };
  useEffect(() => () => clearTimeout(revealTimer.current), []);

  // While revealed, hide once the pointer moves down off the bar. (It slides in under a still
  // pointer, so the bar may never get pointerenter / pointerleave: follow the pointer's y.)
  const menuIsOpen = open !== null;
  useEffect(() => {
    if (!hidden || !revealed || menuIsOpen) return undefined;
    const onMove = (e) => {
      const bar = barRef.current;
      const below = e.clientY > (bar?.offsetHeight ?? 32) + 6;
      if (below && !bar?.contains(document.activeElement)) reveal(false, HIDE_DELAY_MS);
      else if (!below) clearTimeout(revealTimer.current);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [hidden, revealed, menuIsOpen]);

  useEffect(() => {
    document.documentElement.style.setProperty('--menubar-space', hidden ? '0px' : 'var(--menubar-h)');
  }, [hidden]);

  const menus = buildMenus(front, windows, actions);
  // (A menu that no longer exists — the front app changed while open — shows nothing.)
  const openMenu = open !== null && open < menus.length ? menus[open] : null;

  // The zoomed front window's own buttons hide while they're shown in the bar.
  const lightsFor = front?.maximized ? front.app : null;
  useEffect(() => {
    if (!lightsFor) return undefined;
    const el = getController(lightsFor)?.windowRef?.current;
    el?.classList.add('lights-in-menubar');
    return () => el?.classList.remove('lights-in-menubar');
  }, [lightsFor]);

  const close = () => {
    setOpen(null);
    setActive(-1);
    // A revealed bar slides away again once the menu is done, unless the pointer is on it.
    if (!hoverRef.current && !barRef.current?.contains(document.activeElement)) reveal(false, HIDE_DELAY_MS);
  };

  const show = (index, highlightFirst = false) => {
    setOpen(index);
    setLeft(titleRefs.current[index]?.offsetLeft ?? 0);
    setActive(highlightFirst ? menus[index].items.findIndex(isActionable) : -1);
  };

  const run = (item) => {
    if (!isActionable(item)) return;
    close();
    item.onSelect?.();
  };

  // While a menu is open: outside presses, Esc, the page losing focus and resizes close it;
  // arrows move through items and menus, Enter picks.
  const keyHandler = useRef(null);
  useEffect(() => {
    keyHandler.current = (e) => {
      if (!openMenu) return;
      const items = openMenu.items;
      const step = (from, dir) => {
        for (let n = 1; n <= items.length; n++) {
          const i = (from + dir * n + items.length * 2) % items.length;
          if (isActionable(items[i])) return i;
        }
        return -1;
      };
      if (e.key === 'Escape' || e.key === 'Tab') {
        close();
      } else if (e.key === 'ArrowDown') {
        setActive(step(active < 0 ? -1 : active, 1));
      } else if (e.key === 'ArrowUp') {
        setActive(step(active < 0 ? items.length : active, -1));
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        show((open + (e.key === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length, true);
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (active >= 0) run(items[active]);
        else close();
      } else {
        return;
      }
      e.preventDefault();
      e.stopPropagation(); // Esc must not also close the window underneath
    };
  });

  const closeMenu = useEffectEvent(() => close());
  const menuOpen = open !== null;
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => keyHandler.current?.(e);
    const onPointerDown = (e) => {
      if (!barRef.current?.contains(e.target)) closeMenu();
    };
    const onLeave = () => closeMenu();
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', onLeave);
    window.addEventListener('resize', onLeave);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', onLeave);
      window.removeEventListener('resize', onLeave);
    };
  }, [menuOpen]);

  return (
    <>
    {hidden && !revealed && (
      <div className="mb-hotzone" aria-hidden="true" onPointerEnter={() => reveal(true, REVEAL_DELAY_MS)} onPointerLeave={() => clearTimeout(revealTimer.current)} />
    )}
    <nav
      ref={barRef}
      className={`mb${open !== null ? ' is-menu-open' : ''}${hidden ? ' is-autohide' : ''}${revealed ? ' is-revealed' : ''}`}
      aria-label="Menu bar"
      // Clicking the bar never moves focus out of a text field.
      onMouseDown={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      onPointerEnter={() => {
        hoverRef.current = true;
        if (hidden) reveal(true, 0);
      }}
      onPointerLeave={() => {
        hoverRef.current = false;
        if (hidden && open === null) reveal(false, HIDE_DELAY_MS);
      }}
      // Keyboard users reach it with Tab: it shows while focus is in it.
      onFocus={() => hidden && reveal(true, 0)}
      onBlur={(e) => {
        if (hidden && open === null && !hoverRef.current && !e.currentTarget.contains(e.relatedTarget)) reveal(false, HIDE_DELAY_MS);
      }}
    >
      {lightsFor && <TrafficLights front={front} />}
      <div className="mb-left" role="menubar">
        {menus.map((menu, i) => (
          <button
            key={menu.id}
            ref={(el) => {
              titleRefs.current[i] = el;
            }}
            type="button"
            className={`mb-title${menu.id === 'iweb' ? ' mb-logo' : ''}${menu.id === 'app' ? ' mb-app' : ''}${open === i ? ' is-open' : ''}`}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === i}
            aria-label={menu.label}
            onClick={() => (open === i ? close() : show(i))}
            onPointerEnter={() => {
              if (open !== null && open !== i) show(i);
            }}
            onKeyDown={(e) => {
              if (open === null && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
                e.preventDefault();
                show(i, true);
              }
            }}
          >
            {menu.title}
          </button>
        ))}
      </div>
      <StatusIcons onSpotlight={actions.openSpotlight} />
      {openMenu && (
        <MenuPanel
          menu={openMenu}
          left={left}
          active={active}
          setActive={setActive}
          onRun={run}
        />
      )}
    </nav>
    </>
  );
}
