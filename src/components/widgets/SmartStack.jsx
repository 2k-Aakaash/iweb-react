import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import Weather from '../Weather';
import CurrencyWidget from './CurrencyWidget';
import GoldWidget from './GoldWidget';
import MarketsWidget from './MarketsWidget';
import '../../styles/widgets.css';

// macOS-style Smart Stack for the top-right widgets: one card-sized slot that flips between
// widgets with the mouse wheel / trackpad, a touch swipe, ArrowUp/ArrowDown or the page dots.
// Every page stays mounted (Weather keeps its data, nothing refetches on a flip); inactive
// pages are hidden with visibility/content-visibility + inert, so they cost no paint or layout.

// Page registry: every widget receives { active, onExpandedChange }. `active` is true while
// the page is the visible one (use it to pause polling); a widget that expands in place
// reports it through onExpandedChange so flipping is disabled meanwhile.
const PAGES = [
  { id: 'weather', label: 'Weather', Component: Weather },
  { id: 'currency', label: 'Currency Converter', Component: CurrencyWidget },
  { id: 'metals', label: 'Gold & Silver', Component: GoldWidget },
  { id: 'markets', label: 'Markets', Component: MarketsWidget },
];

const WHEEL_THRESHOLD = 60; // px of accumulated wheel delta that flips one page
const WHEEL_COOLDOWN_MS = 450; // minimum time between two wheel flips
const WHEEL_GESTURE_GAP_MS = 160; // a pause this long ends a wheel / trackpad gesture
const SWIPE_THRESHOLD = 40; // px of touch travel that flips one page
const SWIPE_MAX_MS = 800;
const TRANSITION_MS = 280;
const HINT_MS = 1200;

// Gestures that start inside these belong to the widget itself (scrollers, form fields).
const NO_FLIP_SELECTOR = '.forecast-scroll-wrapper, input, select, textarea, [contenteditable="true"], [data-stack-no-flip]';

function isNoFlipTarget(target, root) {
  if (!(target instanceof Element)) return false;
  const match = target.closest(NO_FLIP_SELECTOR);
  return Boolean(match && root.contains(match));
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

// Dominant-axis wheel delta in pixels (deltaMode 1 = lines, 2 = pages).
function wheelDelta(e) {
  const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 150 : 1;
  const dx = e.deltaX * scale;
  const dy = e.deltaY * scale;
  return Math.abs(dy) >= Math.abs(dx) ? dy : dx;
}

export default function SmartStack() {
  const [view, setView] = useState({ active: 0, leaving: null, direction: 1 });
  const [expanded, setExpanded] = useState({});
  const [hint, setHint] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const stackRef = useRef(null);
  const wheelRef = useRef({ accum: 0, lastAt: 0, lockUntil: 0 });
  const touchRef = useRef(null);
  const timersRef = useRef({ transition: 0, hint: 0 });
  const helpId = useId();

  const activePage = PAGES[view.active];
  // Flipping is disabled while the visible widget is expanded.
  const locked = Boolean(expanded[activePage.id]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      clearTimeout(timers.transition);
      clearTimeout(timers.hint);
    };
  }, []);

  // A widget reports its expanded state. If a hidden one expands (e.g. Spotlight's
  // `/weather` command clicks the weather card), bring it to the front.
  const reportExpanded = useCallback((id, value) => {
    setExpanded((prev) => (prev[id] === value ? prev : { ...prev, [id]: value }));
    if (!value) return;
    const index = PAGES.findIndex((page) => page.id === id);
    setView((prev) => (prev.active === index ? prev : { active: index, leaving: null, direction: 1 }));
  }, []);

  // One stable callback per page.
  const expandHandlers = useMemo(
    () => Object.fromEntries(PAGES.map((page) => [page.id, (value) => reportExpanded(page.id, value)])),
    [reportExpanded],
  );

  const showPage = (index, direction) => {
    if (locked || index === view.active) return false;
    const timers = timersRef.current;
    const animate = !prefersReducedMotion();

    // Focus inside the outgoing page would be dropped when it turns inert; keep it on the stack.
    const stack = stackRef.current;
    const focused = document.activeElement;
    if (stack && focused !== stack && focused?.closest('.ws-page') && stack.contains(focused)) {
      stack.focus({ preventScroll: true });
    }

    setView({ active: index, leaving: animate ? view.active : null, direction });
    clearTimeout(timers.transition);
    if (animate) {
      timers.transition = setTimeout(() => {
        setView((prev) => (prev.leaving === null ? prev : { ...prev, leaving: null }));
      }, TRANSITION_MS);
    }

    setAnnouncement(`${PAGES[index].label}, widget ${index + 1} of ${PAGES.length}`);
    setHint(true);
    clearTimeout(timers.hint);
    timers.hint = setTimeout(() => setHint(false), HINT_MS);
    return true;
  };

  // +1 = next page (enters from below), -1 = previous. The stack wraps around.
  const flip = (direction) => {
    const next = (view.active + direction + PAGES.length) % PAGES.length;
    return showPage(next, direction);
  };

  const handleWheel = useEffectEvent((e) => {
    const stack = stackRef.current;
    if (!stack || e.ctrlKey || locked || isNoFlipTarget(e.target, stack)) return;
    const delta = wheelDelta(e);
    if (!delta) return;

    const wheel = wheelRef.current;
    const now = performance.now();
    if (now < wheel.lockUntil) {
      // Still the gesture that just flipped (incl. trackpad momentum): keep it locked
      // until the events pause, so one flick never turns more than one page.
      wheel.lockUntil = Math.max(wheel.lockUntil, now + WHEEL_GESTURE_GAP_MS);
      wheel.lastAt = now;
      return;
    }
    if (now - wheel.lastAt > WHEEL_GESTURE_GAP_MS || Math.sign(delta) !== Math.sign(wheel.accum)) {
      wheel.accum = 0;
    }
    wheel.lastAt = now;
    wheel.accum += delta;
    if (Math.abs(wheel.accum) < WHEEL_THRESHOLD) return;

    const direction = wheel.accum > 0 ? 1 : -1;
    wheel.accum = 0;
    wheel.lockUntil = now + WHEEL_COOLDOWN_MS;
    if (flip(direction)) e.preventDefault();
  });

  // Native listener: React's onWheel is passive, and a flip must be able to preventDefault.
  useEffect(() => {
    const stack = stackRef.current;
    if (!stack) return undefined;
    const onWheel = (e) => handleWheel(e);
    stack.addEventListener('wheel', onWheel, { passive: false });
    return () => stack.removeEventListener('wheel', onWheel);
  }, []);

  const handleKeyDown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (isNoFlipTarget(e.target, e.currentTarget)) return;
    if (flip(e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault();
  };

  const handleTouchStart = (e) => {
    if (e.touches.length !== 1 || isNoFlipTarget(e.target, e.currentTarget)) {
      touchRef.current = null;
      return;
    }
    const touch = e.touches[0];
    touchRef.current = { x: touch.clientX, y: touch.clientY, time: e.timeStamp };
  };

  const handleTouchEnd = (e) => {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start || e.changedTouches.length !== 1 || e.timeStamp - start.time > SWIPE_MAX_MS) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const distance = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
    if (Math.abs(distance) < SWIPE_THRESHOLD) return;
    // Finger moving up / left brings the next page, like scrolling content.
    flip(distance < 0 ? 1 : -1);
  };

  const handleTouchCancel = () => {
    touchRef.current = null;
  };

  const pageClass = (index) => {
    if (index === view.active) {
      if (view.leaving === null) return 'ws-page ws-page-active';
      return `ws-page ws-page-active ${view.direction > 0 ? 'ws-enter-next' : 'ws-enter-prev'}`;
    }
    if (index === view.leaving) {
      return `ws-page ws-page-leaving ${view.direction > 0 ? 'ws-leave-next' : 'ws-leave-prev'}`;
    }
    return 'ws-page ws-page-hidden';
  };

  const stackClass = `ws-stack${hint ? ' ws-hint' : ''}${locked ? ' ws-locked' : ''}`;

  return (
    <div
      ref={stackRef}
      className={stackClass}
      role="region"
      aria-roledescription="widget stack"
      aria-label={activePage.label}
      aria-describedby={helpId}
      aria-keyshortcuts="ArrowUp ArrowDown"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      {PAGES.map((page, index) => {
        const isActive = index === view.active;
        return (
          <div
            key={page.id}
            className={pageClass(index)}
            role="group"
            aria-roledescription="widget"
            aria-label={page.label}
            aria-hidden={isActive ? undefined : true}
            inert={!isActive}
          >
            <page.Component active={isActive} onExpandedChange={expandHandlers[page.id]} />
          </div>
        );
      })}

      <div className="ws-indicator">
        <div className="ws-dots">
          {PAGES.map((page, index) => (
            <button
              key={page.id}
              type="button"
              className="ws-dot"
              aria-label={`Show ${page.label}`}
              aria-current={index === view.active ? 'true' : undefined}
              onClick={() => showPage(index, index > view.active ? 1 : -1)}
            />
          ))}
        </div>
      </div>

      <span id={helpId} className="ws-sr-only">Scroll, swipe or use the arrow keys to switch widgets.</span>
      <span className="ws-sr-only" aria-live="polite" aria-atomic="true">{announcement}</span>
    </div>
  );
}
