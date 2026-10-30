import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GRID, ITEMS, MARGIN, PITCH, WIDGET_SIZES, alignRect, topMargin } from '../../libs/desktop/layout';
import { setEditing, updateItem, useDesktop } from '../../libs/desktop/layoutStore';
import { setGuides } from '../../libs/desktop/guides';
import { landingFor, occupiedRects } from '../../libs/desktop/placement';
import '../../styles/desktop.css';

// A movable item on the iWeb desktop (clock, search bar, widgets). Positioned by its anchors
// with plain CSS (left/right/top/bottom or the centre), so a card that grows in place (the
// Weather card expanding) grows away from its anchored edge; a measured nudge keeps it on
// screen. In Edit Widgets mode a shield covers the content: drag to move, the corner handle
// to resize, arrows to nudge. Widgets land in slots (macOS 26's grid, a placeholder shows
// where); the clock and search bar move freely with alignment guides and a grid snap.
// Nothing overlaps; drops settle with a spring.

const SETTLE_MS = 420;
// Press and hold an item (outside edit mode) to enter Edit Widgets, as on macOS 26; keep
// holding and move to carry it straight away. Moving first cancels (scrolling, selecting).
const HOLD_MS = 550;
const HOLD_SLOP = 8; // px the pointer may wander during the hold
// Holding in these keeps its usual meaning (selecting text, editing a field).
const NO_HOLD_SELECTOR = 'input, textarea, select, [contenteditable="true"], .dt-menu';
const SETTLE_EASE = 'cubic-bezier(0.34, 1.32, 0.64, 1)'; // a gentle spring overshoot

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

// Centred anchors shift the item back by half its size. The shifts are lengths ('0px', not
// '0'): calc() can't add a number to a length, and an invalid transform is silently dropped.
function anchorStyle(pos) {
  const style = {};
  const shift = ['0px', '0px'];
  if (pos.ax === 'left') style.left = pos.x;
  else if (pos.ax === 'right') style.right = pos.x;
  else {
    style.left = `calc(50% + ${pos.x}px)`;
    shift[0] = '-50%';
  }
  if (pos.ay === 'top') style.top = pos.y;
  else if (pos.ay === 'bottom') style.bottom = pos.y;
  else {
    style.top = `calc(50% + ${pos.y}px)`;
    shift[1] = '-50%';
  }
  return { style, shift };
}

const rectOf = (el) => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, w: r.width, h: r.height };
};

// Other items plus the Dynamic Island and the Dock, which nothing may cover.
const otherRects = (self) => occupiedRects(self);

// Widget sizes step to the one nearest the dragged corner; scale items step one size per
// ~18% of growth or shrink.
function nextSize(id, size, startRect, dx, dy) {
  const def = ITEMS[id];
  if (def.kind === 'widget') {
    const w = startRect.w + dx;
    const h = startRect.h + dy;
    let best = size;
    let bestDist = Infinity;
    for (const candidate of def.sizes) {
      const dim = WIDGET_SIZES[candidate];
      const dist = (dim.w - w) ** 2 + (dim.h - h) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
    return best;
  }
  const ratio = (startRect.w + dx) / startRect.w;
  const index = def.sizes.indexOf(size);
  if (ratio > 1.18 && index < def.sizes.length - 1) return def.sizes[index + 1];
  if (ratio < 0.85 && index > 0) return def.sizes[index - 1];
  return size;
}

export default function DesktopItem({ id, children, className = '' }) {
  const { layout, editing } = useDesktop();
  const item = layout[id];
  const def = ITEMS[id];
  const ref = useRef(null);
  const flipFrom = useRef(null);
  const dragRef = useRef(null);
  const holdRef = useRef(null);
  const [nudge, setNudge] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [holding, setHolding] = useState(false);

  const { style, shift } = anchorStyle(item);
  const transformFor = (extraX = 0, extraY = 0) =>
    `translate(calc(${shift[0]} + ${nudge.x + extraX}px), calc(${shift[1]} + ${nudge.y + extraY}px))`;

  // Keep the item on screen (window resizes, a card expanding near an edge). Measured from the
  // layout box (offset*), which ignores transforms: the edit-mode scale, a drag in progress
  // and the nudge itself, so the result is stable and never feeds back into itself.
  const centredX = item.ax === 'center';
  const centredY = item.ay === 'middle';
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || item.hidden) return undefined;
    const fit = () => {
      if (dragRef.current) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = el.offsetLeft - (centredX ? w / 2 : 0);
      const top = el.offsetTop - (centredY ? h / 2 : 0);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const x = Math.round(Math.min(Math.max(left, MARGIN), Math.max(MARGIN, vw - w - MARGIN)) - left);
      const y = Math.round(Math.min(Math.max(top, topMargin()), Math.max(topMargin(), vh - h - MARGIN)) - top);
      setNudge((prev) => (prev.x === x && prev.y === y ? prev : { x, y }));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    window.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [item.ax, item.x, item.ay, item.y, item.size, item.hidden, centredX, centredY]);

  // Settle: animate from where the item was dropped to its new resting place (FLIP).
  useLayoutEffect(() => {
    const el = ref.current;
    const from = flipFrom.current;
    flipFrom.current = null;
    if (!el || !from) return;
    const to = el.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const done = () => window.dispatchEvent(new Event('resize')); // glass re-renders for its new spot
    if ((!dx && !dy) || prefersReducedMotion()) {
      done();
      return;
    }
    el.animate(
      [{ transform: transformFor(dx, dy) }, { transform: transformFor() }],
      { duration: SETTLE_MS, easing: SETTLE_EASE },
    ).finished.then(done, () => {});
  }, [item.ax, item.ay, item.x, item.y, item.size]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving edit mode mid-drag ends the drag where it is.
  useEffect(() => {
    if (!editing && dragRef.current) {
      dragRef.current = null;
      setDragging(false);
      setGuides({});
      if (ref.current) ref.current.style.transform = transformFor();
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  // A hold that hasn't finished when the item goes away (or edit mode starts elsewhere).
  useEffect(() => () => holdRef.current?.cancel(), []);
  useEffect(() => {
    if (editing) holdRef.current?.cancel();
  }, [editing]);

  if (item.hidden) return null;

  const commitPos = (pos, visualFrom) => {
    flipFrom.current = visualFrom;
    // The nudge belongs to the old spot; the new spot is on screen by construction.
    setNudge({ x: 0, y: 0 });
    updateItem(id, pos);
  };

  const commitRect = (rect, visualFrom) => {
    const landing = landingFor(id, rect, ref.current, item.size);
    if (!landing) return false;
    commitPos(landing.pos, visualFrom);
    return true;
  };

  // --- press and hold (not editing) → Edit Widgets ------------------------------------------
  const onHoldStart = (e) => {
    if (editing || e.button !== 0 || !e.isPrimary) return;
    if (e.target instanceof Element && e.target.closest(NO_HOLD_SELECTOR)) return;
    holdRef.current?.cancel();
    const el = ref.current;
    const start = { x: e.clientX, y: e.clientY };
    const { pointerId } = e;
    let last = start;
    const onMove = (ev) => {
      if (ev.pointerId !== pointerId) return;
      last = { x: ev.clientX, y: ev.clientY };
      if (Math.hypot(last.x - start.x, last.y - start.y) > HOLD_SLOP) cancel();
    };
    const onEnd = (ev) => {
      if (ev.pointerId === pointerId) cancel();
    };
    const timer = setTimeout(() => {
      cleanup();
      setHolding(false);
      // The release must not also click what's under it (open News, expand Weather…).
      const swallow = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 600);
      window.getSelection?.()?.removeAllRanges();
      setEditing(true);
      // Keep going: the same press now moves the item.
      try {
        el.setPointerCapture(pointerId);
      } catch {
        return; // the pointer is already gone: just edit mode
      }
      dragRef.current = { mode: 'move', x: last.x, y: last.y, start: rectOf(el), others: otherRects(el), rect: null };
      setDragging(true);
    }, HOLD_MS);
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onEnd, true);
      window.removeEventListener('pointercancel', onEnd, true);
      window.removeEventListener('wheel', cancel, true);
      if (holdRef.current?.cancel === cancel) holdRef.current = null;
    };
    function cancel() {
      cleanup();
      setHolding(false);
    }
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onEnd, true);
    window.addEventListener('pointercancel', onEnd, true);
    window.addEventListener('wheel', cancel, true);
    holdRef.current = { cancel };
    setHolding(true);
  };

  // --- move -------------------------------------------------------------------------------
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = ref.current;
    el.setPointerCapture(e.pointerId);
    dragRef.current = { mode: 'move', x: e.clientX, y: e.clientY, start: rectOf(el), others: otherRects(el), rect: null };
    setDragging(true);
  };

  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (drag.mode === 'move' && def.kind === 'widget') {
      // The widget follows the pointer; the placeholder shows the slot it will land in.
      drag.rect = { ...drag.start, left: drag.start.left + dx, top: drag.start.top + dy };
      ref.current.style.transform = transformFor(dx, dy);
      drag.landing = landingFor(id, drag.rect, ref.current, item.size);
      setGuides({ slot: drag.landing?.rect || null });
    } else if (drag.mode === 'move') {
      const raw = { ...drag.start, left: drag.start.left + dx, top: drag.start.top + dy };
      const aligned = alignRect(raw, drag.others, window.innerWidth, window.innerHeight);
      drag.rect = aligned.rect;
      ref.current.style.transform = transformFor(aligned.rect.left - drag.start.left, aligned.rect.top - drag.start.top);
      setGuides(aligned.guides);
    } else {
      const size = nextSize(id, drag.size, drag.start, dx, dy);
      if (size !== drag.size) {
        drag.size = size;
        updateItem(id, { size });
      }
    }
  };

  const endDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    setGuides({});
    const el = ref.current;
    if (!drag || !el) return;
    if (drag.mode === 'move') {
      const visual = el.getBoundingClientRect();
      // Back to the base transform React last rendered (it only rewrites changed styles).
      el.style.transform = transformFor();
      const landed = drag.rect && (def.kind === 'widget'
        ? Boolean(drag.landing) && (commitPos(drag.landing.pos, visual), true)
        : commitRect(drag.rect, visual));
      if (!landed) {
        // No room there: spring back to where it was.
        const dx = (drag.rect?.left ?? drag.start.left) - drag.start.left;
        const dy = (drag.rect?.top ?? drag.start.top) - drag.start.top;
        if ((dx || dy) && !prefersReducedMotion()) {
          el.animate([{ transform: transformFor(dx, dy) }, { transform: transformFor() }], { duration: SETTLE_MS, easing: SETTLE_EASE });
        }
      }
    } else {
      // A larger size may now overlap a neighbour: move to the nearest free spot.
      requestAnimationFrame(() => {
        if (!ref.current) return;
        const rect = rectOf(ref.current);
        const landing = landingFor(id, rect, ref.current, drag.size);
        if (landing) commitPos(landing.pos, ref.current.getBoundingClientRect());
        window.dispatchEvent(new Event('resize'));
      });
    }
  };

  // --- resize -----------------------------------------------------------------------------
  const onResizeDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    el.setPointerCapture(e.pointerId);
    dragRef.current = { mode: 'resize', x: e.clientX, y: e.clientY, start: rectOf(el), size: item.size };
    setDragging(true);
  };

  // --- keyboard ---------------------------------------------------------------------------
  const onKeyDown = (e) => {
    // Widgets move a slot at a time; the clock and search bar by the grid.
    const step = def.kind === 'widget' ? PITCH : e.shiftKey ? GRID * 4 : GRID;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      const el = ref.current;
      const rect = rectOf(el);
      const [dx, dy] = moves[e.key];
      commitRect({ ...rect, left: rect.left + dx, top: rect.top + dy }, el.getBoundingClientRect());
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && def.removable) {
      e.preventDefault();
      updateItem(id, { hidden: true });
    }
  };

  const classes = [
    'dt-item',
    `dt-item-${def.kind}`,
    editing ? 'is-editing' : '',
    dragging ? 'is-dragging' : '',
    holding && !editing ? 'is-holding' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={ref}
      className={classes}
      data-desktop-item={id}
      data-size={item.size}
      style={{ ...style, transform: transformFor() }}
      onPointerDown={editing ? undefined : onHoldStart}
      onPointerMove={editing ? onPointerMove : undefined}
      onPointerUp={editing ? endDrag : undefined}
      onPointerCancel={editing ? endDrag : undefined}
    >
      {children}
      {editing && (
        <>
          <div
            className="dt-shield"
            role="button"
            tabIndex={0}
            aria-label={`${def.label}. Drag or use the arrow keys to move${def.removable ? ', Delete to remove' : ''}.`}
            onPointerDown={onPointerDown}
            onKeyDown={onKeyDown}
          />
          {def.removable && (
            <button
              type="button"
              className="dt-remove"
              aria-label={`Remove ${def.label}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => updateItem(id, { hidden: true })}
            >
              <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3 6h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          )}
          {def.sizes.length > 1 && (
            <span className="dt-resize" aria-hidden="true" onPointerDown={onResizeDown} title="Drag to resize" />
          )}
        </>
      )}
    </div>
  );
}
