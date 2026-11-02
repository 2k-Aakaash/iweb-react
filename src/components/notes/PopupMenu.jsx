import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../../styles/desktop.css';

// A menu for Notes and the sticky cards, in the desktop menu's look (desktop.css .dt-menu):
// opened from a button (`anchor`: an element) or at the pointer (`anchor`: { x, y }).
// Items: { label, onSelect, checked?, disabled?, shortcut?, danger? }, { type: 'separator' }
// or { type: 'header', label }. Arrow keys move, Escape closes and returns focus.

export default function PopupMenu({ anchor, items, onClose, label }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left;
    let top;
    if (anchor instanceof Element) {
      const a = anchor.getBoundingClientRect();
      left = Math.min(Math.max(8, a.right - r.width), vw - r.width - 8);
      top = a.bottom + 6 + r.height > vh - 8 ? Math.max(8, a.top - r.height - 6) : a.bottom + 6;
    } else {
      left = Math.min(Math.max(8, anchor.x), vw - r.width - 8);
      top = anchor.y + r.height > vh - 8 ? Math.max(8, anchor.y - r.height) : anchor.y;
    }
    setPos({ left, top });
  }, [anchor]);

  // Focus the first item once the menu is placed (it is hidden until then, and a hidden
  // element can't take focus), so the keyboard, and Escape, go to the menu.
  useEffect(() => {
    if (pos) ref.current?.querySelector('[role^="menuitem"]:not([aria-disabled="true"])')?.focus({ preventScroll: true });
  }, [pos]);

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (anchor instanceof Element && anchor.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [anchor, onClose]);

  const returnFocus = () => {
    if (anchor instanceof Element) anchor.focus?.({ preventScroll: true });
  };

  const onKeyDown = (e) => {
    const list = [...ref.current.querySelectorAll('[role^="menuitem"]:not([aria-disabled="true"])')];
    const i = list.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      returnFocus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
    }
  };

  return createPortal(
    <div
      ref={ref}
      className={`dt-menu nt-menu${pos ? ' is-placed' : ''}`}
      role="menu"
      aria-label={label}
      style={pos || { left: -9999, top: 0 }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.filter(Boolean).map((item, i) => {
        if (item.type === 'separator') return <div key={i} className="dt-menu-sep" role="separator" />;
        if (item.type === 'header') return <div key={i} className="dt-menu-header">{item.label}</div>;
        const radio = item.checked !== undefined;
        return (
          <button
            key={i}
            type="button"
            className={`dt-menu-item${item.danger ? ' is-danger' : ''}`}
            role={radio ? 'menuitemradio' : 'menuitem'}
            aria-checked={radio ? item.checked : undefined}
            aria-disabled={item.disabled || undefined}
            tabIndex={-1}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              item.onSelect();
            }}
          >
            <span className="dt-menu-check" aria-hidden="true">{item.checked ? '✓' : ''}</span>
            {item.swatch && <span className="nt-menu-swatch" style={{ background: item.swatch }} aria-hidden="true" />}
            <span className="dt-menu-label">{item.label}</span>
            {item.shortcut && <span className="dt-menu-shortcut">{item.shortcut}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
