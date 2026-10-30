import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ITEMS, WIDGET_SIZES, placementOf, sizeLabel } from '../../libs/desktop/layout';
import {
  moveToStack,
  placeOnDesktop,
  removeFromDesktop,
  resetLayout,
  setEditing,
  showOnDesktop,
  useDesktop,
} from '../../libs/desktop/layoutStore';
import { landingFor } from '../../libs/desktop/placement';
import SettingsTabIcon from './SettingsTabIcon';
import WidgetPreview from './WidgetPreview';
import '../../styles/settings-widgets.css';

// Settings → Widgets, after macOS 26's widget gallery: search, a list of widgets on the left,
// and every size as a preview. Click a size to put it on the desktop (or resize it there), or
// drag it out: Settings fades away so it can be dropped where it should go.

const ORDER = ['clock', 'search', 'news', 'stack', 'weather', 'currency', 'metals', 'markets'];
const DESCRIPTIONS = {
  clock: 'The time and your greeting. Always on the desktop.',
  search: 'Opens Spotlight. Without it, Ctrl K still does.',
  news: 'Top stories from your feeds, rotating.',
  stack: 'Several widgets in one place: scroll or swipe to flip.',
  weather: 'Current conditions and the forecast.',
  currency: 'Live exchange rates and a converter.',
  metals: 'Gold and silver prices.',
  markets: 'Indices and the stocks you follow.',
};
const STATUS = { desktop: 'On Desktop', stack: 'In Smart Stack', hidden: 'Not on Desktop' };

// Full-size dimensions, as on the desktop; the clock and search bar scale with their size.
const SCALE_SIZES = {
  clock: { small: { w: 240, h: 100 }, medium: { w: 300, h: 128 }, large: { w: 420, h: 160 } },
  search: { small: { w: 260, h: 46 }, medium: { w: 360, h: 46 }, large: { w: 480, h: 46 } },
};
const dimsOf = (id, size) => SCALE_SIZES[id]?.[size] || WIDGET_SIZES[size];
const PREVIEW_SCALE = 0.48;
const DRAG_START = 6; // px before a press becomes a drag

function SizeTile({ id, size, current, onPick, onDragStart }) {
  const dim = dimsOf(id, size);
  const press = useRef(null);
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    press.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e) => {
    const start = press.current;
    if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_START) return;
    press.current = null;
    onDragStart(e, id, size);
  };
  return (
    <div className="wg-size">
      <button
        type="button"
        className={`wg-tile${current ? ' is-current' : ''}`}
        style={{ width: dim.w * PREVIEW_SCALE, height: dim.h * PREVIEW_SCALE }}
        aria-label={`${ITEMS[id].label}, ${sizeLabel(id, size)}${current ? ' (on the desktop)' : ''}`}
        aria-pressed={current}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          press.current = null;
        }}
        onClick={() => onPick(id, size)}
      >
        <span className="wg-tile-inner" style={{ width: dim.w, height: dim.h, transform: `scale(${PREVIEW_SCALE})` }}>
          <WidgetPreview id={id} size={size} />
        </span>
      </button>
      <span className="wg-size-label">{sizeLabel(id, size)}</span>
    </div>
  );
}

function WidgetSection({ id, layout, onPick, onDragStart }) {
  const def = ITEMS[id];
  const where = placementOf(layout, id);
  const item = layout[id];
  const stackPages = id === 'stack' ? layout.stack.pages : null;
  return (
    <section className="wg-section" aria-labelledby={`wg-${id}`}>
      <header className="wg-section-head">
        <SettingsTabIcon id={id} className="wg-section-icon" />
        <div className="wg-section-text">
          <h3 id={`wg-${id}`}>{def.label}</h3>
          <p>
            {stackPages
              ? stackPages.length
                ? `Holds ${stackPages.map((page) => ITEMS[page].label).join(', ')}.`
                : 'Empty: add widgets to it below.'
              : DESCRIPTIONS[id]}
          </p>
        </div>
        <span className={`wg-status is-${where}`}>{STATUS[where]}</span>
      </header>
      <div className="wg-sizes">
        {def.sizes.map((size) => (
          <SizeTile
            key={size}
            id={id}
            size={size}
            current={where === 'desktop' && item.size === size}
            onPick={onPick}
            onDragStart={onDragStart}
          />
        ))}
      </div>
      <div className="wg-actions">
        {where !== 'desktop' && (id !== 'stack' || stackPages.length > 0) && (
          <button type="button" className="wg-btn" onClick={() => showOnDesktop(id)}>
            {where === 'stack' ? 'Detach from Stack' : 'Add to Desktop'}
          </button>
        )}
        {def.stackable && where !== 'stack' && (
          <button type="button" className="wg-btn" onClick={() => moveToStack(id)}>Add to Smart Stack</button>
        )}
        {def.removable && where !== 'hidden' && (
          <button type="button" className="wg-btn wg-btn-quiet" onClick={() => removeFromDesktop(id)}>
            {where === 'stack' ? 'Remove from Stack' : 'Remove'}
          </button>
        )}
      </div>
    </section>
  );
}

export default function WidgetsPane({ onClose }) {
  const { layout } = useDesktop();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('all');
  const [drag, setDrag] = useState(null); // { id, size, x, y, w, h, target }
  const dragRef = useRef(null);
  useEffect(() => {
    dragRef.current = drag;
  });
  const dragTarget = drag?.target ?? null;

  const q = query.trim().toLowerCase();
  const matches = ORDER.filter((id) => !q || ITEMS[id].label.toLowerCase().includes(q) || DESCRIPTIONS[id].toLowerCase().includes(q));
  const shown = selected === 'all' ? matches : matches.filter((id) => id === selected);

  const pick = (id, size) => showOnDesktop(id, size);

  const startDrag = (e, id, size) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const dim = dimsOf(id, size);
    setDrag({ id, size, x: e.clientX, y: e.clientY, w: dim.w, h: dim.h, target: e.currentTarget });
  };

  // While dragging, the ghost follows the pointer and Settings steps aside to show the desktop.
  useEffect(() => {
    const target = dragTarget;
    if (!target) return undefined;
    const root = document.documentElement;
    root.classList.add('wg-dragging');
    const move = (e) => setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
    const end = (e, cancelled = false) => {
      const d = dragRef.current;
      setDrag(null);
      if (!d || cancelled) return;
      // Dropped: the nearest free slot to the pointer (never over the island, Dock or others).
      const rect = { left: e.clientX - d.w / 2, top: e.clientY - d.h / 2, w: d.w, h: d.h };
      const self = document.querySelector(`[data-desktop-item="${d.id}"]`);
      const landing = landingFor(d.id, rect, self, d.size);
      if (landing) placeOnDesktop(d.id, d.size, landing.pos);
    };
    const up = (e) => end(e);
    const cancel = (e) => end(e, true);
    const key = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setDrag(null);
    };
    // The press was captured by the tile, so its events arrive there; the click that follows
    // a drag is swallowed so it doesn't also "pick" the size.
    const swallowClick = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', cancel);
    target.addEventListener('click', swallowClick, { capture: true, once: true });
    window.addEventListener('keydown', key, true);
    return () => {
      root.classList.remove('wg-dragging');
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      // A click (if any) fires right after pointerup; drop the swallower after it.
      setTimeout(() => target.removeEventListener('click', swallowClick, { capture: true }), 0);
    };
  }, [dragTarget]);

  const editWidgets = () => {
    onClose?.();
    setEditing(true);
  };

  return (
    <div className="wg-pane">
      <div className="wg-search">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
        <input
          type="search"
          placeholder="Search Widgets"
          aria-label="Search widgets"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="wg-body">
        <nav className="wg-list" aria-label="Widgets">
          <button type="button" className={`wg-list-item${selected === 'all' ? ' is-active' : ''}`} onClick={() => setSelected('all')}>
            <SettingsTabIcon id="widgets" className="wg-list-icon" />
            All Widgets
          </button>
          {matches.map((id) => (
            <button
              key={id}
              type="button"
              className={`wg-list-item${selected === id ? ' is-active' : ''}`}
              aria-current={selected === id ? 'true' : undefined}
              onClick={() => setSelected(id)}
            >
              <SettingsTabIcon id={id} className="wg-list-icon" />
              {ITEMS[id].label}
            </button>
          ))}
        </nav>

        <div className="wg-gallery custom-scrollbar">
          {shown.length
            ? shown.map((id) => <WidgetSection key={id} id={id} layout={layout} onPick={pick} onDragStart={startDrag} />)
            : <p className="wg-empty">No widgets match “{query}”.</p>}
        </div>
      </div>

      <footer className="wg-footer">
        <span>Click a size to place it on the desktop, or drag it to where it should go.</span>
        <button type="button" className="wg-btn wg-btn-quiet" onClick={resetLayout}>Reset Layout</button>
        <button type="button" className="wg-btn wg-btn-primary" onClick={editWidgets}>Edit Widgets</button>
      </footer>

      {drag && createPortal(
        <div
          className="wg-ghost"
          style={{ width: drag.w, height: drag.h, left: drag.x - drag.w / 2, top: drag.y - drag.h / 2 }}
          aria-hidden="true"
        >
          <WidgetPreview id={drag.id} size={drag.size} />
        </div>,
        document.body,
      )}
    </div>
  );
}
