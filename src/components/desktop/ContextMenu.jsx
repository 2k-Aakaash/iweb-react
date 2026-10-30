import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ITEMS, addableItems, sizeLabel } from '../../libs/desktop/layout';
import { getDesktopState, moveToStack, setEditing, showOnDesktop, updateItem } from '../../libs/desktop/layoutStore';
import { openNews } from '../../libs/news/newsEvents';
import '../../styles/desktop.css';

// iWeb's right-click menu, in place of the browser's, styled after macOS 26 menus (plain
// frosted CSS, no Liquid Glass). The browser's own menu stays where it is useful: text fields,
// selected text, and inside app windows (Notes, Settings…), whose content has its own uses.

const NATIVE_INSIDE = [
  'input', 'textarea', 'select', '[contenteditable="true"]', '[role="dialog"]', '[aria-modal="true"]',
  '.settings-overlay', '.search-modal-overlay', '.notes-overhaul-modal', '.music-overhaul-modal',
  '.news-overlay', '.mk-overlay', 'iframe',
].join(',');

function wantsNativeMenu(target) {
  if (!(target instanceof Element)) return true;
  if (target.closest(NATIVE_INSIDE)) return true;
  const selection = window.getSelection?.();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

function buildMenu(target, actions) {
  const { layout } = getDesktopState();
  const link = target.closest('a[href]');
  if (link && /^https?:/i.test(link.href)) {
    return [
      { label: 'Open Link', onSelect: () => window.open(link.href, '_blank', 'noopener,noreferrer') },
      { label: 'Copy Link Address', onSelect: () => navigator.clipboard?.writeText(link.href).catch(() => {}) },
    ];
  }

  const itemEl = target.closest('[data-desktop-item]');
  if (itemEl) {
    const id = itemEl.dataset.desktopItem;
    const def = ITEMS[id];
    const current = layout[id];
    const extras = [];
    if (id === 'news') extras.push({ label: 'Open News', onSelect: () => openNews() });
    if (id === 'clock') extras.push({ label: 'Change Clock Font…', onSelect: () => actions.openSettings('general') });
    if (id === 'search') extras.push({ label: 'Spotlight Search', shortcut: 'Ctrl K', onSelect: actions.openSpotlight });
    // The stack's visible widget can leave it; a widget on its own can join it.
    const page = id === 'stack' ? itemEl.querySelector('[data-active-page]')?.dataset.activePage : null;
    if (page && ITEMS[page]) extras.push({ label: `Detach ${ITEMS[page].label}`, onSelect: () => showOnDesktop(page) });
    if (def.stackable) extras.push({ label: 'Add to Smart Stack', onSelect: () => moveToStack(id) });
    return [
      { type: 'header', label: def.label },
      ...def.sizes.map((size) => ({
        label: sizeLabel(id, size),
        checked: current.size === size,
        onSelect: () => updateItem(id, { size }),
      })),
      { type: 'separator' },
      ...extras,
      { label: 'Edit Widgets…', onSelect: () => setEditing(true) },
      { label: 'Widget Gallery…', onSelect: actions.openWidgetGallery },
      ...(def.removable ? [{ type: 'separator' }, { label: 'Remove Widget', onSelect: () => updateItem(id, { hidden: true }) }] : []),
    ];
  }

  const hidden = addableItems(layout);
  return [
    { label: 'Edit Widgets…', onSelect: () => setEditing(true) },
    { label: 'Widget Gallery…', onSelect: actions.openWidgetGallery },
    { type: 'separator' },
    { label: 'Change Wallpaper…', onSelect: () => actions.openSettings('wallpaper') },
    { label: 'Next Wallpaper', onSelect: actions.nextWallpaper },
    { type: 'separator' },
    { label: 'Spotlight Search', shortcut: 'Ctrl K', onSelect: actions.openSpotlight },
    { label: 'Settings…', onSelect: () => actions.openSettings('general') },
    ...(hidden.length
      ? [{ type: 'separator' }, ...hidden.map((id) => ({ label: `Add ${ITEMS[id].label}`, onSelect: () => showOnDesktop(id) }))]
      : []),
  ];
}

export default function ContextMenu({ actions }) {
  const [menu, setMenu] = useState(null); // { x, y, items }
  const menuRef = useRef(null);
  const [placement, setPlacement] = useState(null);
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  });

  useEffect(() => {
    const onContextMenu = (e) => {
      if (wantsNativeMenu(e.target)) {
        setMenu(null);
        return;
      }
      e.preventDefault();
      setPlacement(null);
      setMenu({ x: e.clientX, y: e.clientY, items: buildMenu(e.target, actionsRef.current) });
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);

  // Close on any outside press, scroll, resize or when the page loses focus.
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const onPointerDown = (e) => {
      if (!menuRef.current?.contains(e.target)) close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('wheel', close);
    };
  }, [menu]);

  // Keep it on screen: flip left/up when it would overflow, then focus the first item.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    const r = el.getBoundingClientRect();
    const left = menu.x + r.width > window.innerWidth - 8 ? Math.max(8, menu.x - r.width) : menu.x;
    const top = menu.y + r.height > window.innerHeight - 8 ? Math.max(8, menu.y - r.height) : menu.y;
    setPlacement({ left, top });
    el.querySelector('[role^="menuitem"]:not([aria-disabled="true"])')?.focus({ preventScroll: true });
  }, [menu]);

  if (!menu) return null;

  const run = (item) => {
    setMenu(null);
    item.onSelect?.();
  };

  const onKeyDown = (e) => {
    const items = [...menuRef.current.querySelectorAll('[role^="menuitem"]')];
    const index = items.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setMenu(null);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
    }
  };

  return (
    <div
      ref={menuRef}
      className={`dt-menu${placement ? ' is-placed' : ''}`}
      role="menu"
      style={placement || { left: menu.x, top: menu.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item, i) => {
        if (item.type === 'separator') return <div key={i} className="dt-menu-sep" role="separator" />;
        if (item.type === 'header') return <div key={i} className="dt-menu-header">{item.label}</div>;
        const radio = item.checked !== undefined;
        return (
          <button
            key={i}
            type="button"
            className="dt-menu-item"
            role={radio ? 'menuitemradio' : 'menuitem'}
            aria-checked={radio ? item.checked : undefined}
            tabIndex={-1}
            onClick={() => run(item)}
          >
            <span className="dt-menu-check" aria-hidden="true">{item.checked ? '✓' : ''}</span>
            <span className="dt-menu-label">{item.label}</span>
            {item.shortcut && <span className="dt-menu-shortcut">{item.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}
