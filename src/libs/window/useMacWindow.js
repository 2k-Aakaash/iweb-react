import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useGenie } from '../genie/useGenie';
import { prefersReducedMotion } from '../genie/genie';
import { focusWindow, registerController, setWindowState } from './windowRegistry';
import {
  TITLE_HEIGHT,
  applyFrame,
  clampFrame,
  edgeAt,
  frameOf,
  isNoDragTarget,
  loadFrame,
  resizeFrame,
  saveFrame,
  showSnapPreview,
  snapZoneAt,
} from './windowFrame';
import '../../styles/mac-window.css';

// macOS-style window controls for iWeb's app windows (Settings, Notes, Music).
//
//   const win = useMacWindow({ app: 'notes', open, setOpen, windowRef, overlayRef });
//   if (!win.mounted) return null;
//   <span className="window-dot dot-close" onClick={win.close} />   // red
//   <span className="window-dot dot-minimize" onClick={win.minimize} />  // yellow
//   <span className="window-dot dot-maximize" onClick={win.toggleMaximize} />  // green
//
//   red    — close: a quick fade and shrink in place (macOS close).
//   yellow — minimize: the genie into the app's Dock icon. Opening it again genies it back
//            out, as it was left (zoomed state included).
//   green  — zoom: the window grows to fill the screen (and back) with a spring-like ease.
//
// Windows move (drag the title area), resize (drag an edge or corner) and snap to half or all
// of the screen (drop on an edge), each app remembering where it was (windowFrame.js).
// Opening from the Dock always genies out of the icon. Each app reports its state on the
// `iweb:window` event so the Dock can show its running dot, and to the window registry
// (windowRegistry.js) so the menu bar knows the front app. `menus` (a function, or a ref to
// one) returns the app's own menu-bar items: { File: [...], View: [...], Controls: [...] },
// each { label, onSelect, checked?, disabled?, shortcut? } or { type: 'separator' } (MenuBar.jsx).

const ZOOM_MS = 460;
const ZOOM_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'; // fast start, long soft settle (macOS-like)

export const WINDOW_EVENT = 'iweb:window';

const framesEnabled = () => typeof window !== 'undefined' && window.innerWidth >= 700;

export function useMacWindow({ app, open, setOpen, windowRef, overlayRef, menus = null }) {
  const closeEffectRef = useRef('genie');
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [tile, setTile] = useState(null); // 'left' | 'right' half of the screen, or null
  const fromRect = useRef(null);
  const zoomAnim = useRef(null);

  // The window's own frame (moved / resized), or none while zoomed or snapped. Runs before the
  // genie (declared first), so it genies to and from where the window really is.
  useLayoutEffect(() => {
    const el = windowRef.current;
    if (!open || !el || !framesEnabled()) return;
    if (tile) el.dataset.tile = tile;
    else delete el.dataset.tile;
    if (maximized || tile) applyFrame(el, null);
    else {
      const saved = loadFrame(app);
      applyFrame(el, saved ? clampFrame(saved) : null);
    }
  }, [app, open, maximized, tile, windowRef]);

  const mounted = useGenie(open, {
    target: `[data-action="${app}"] button`,
    windowRef,
    overlayRef,
    closeEffectRef,
  });

  const close = useCallback(() => {
    closeEffectRef.current = 'fade';
    setMinimized(false);
    setMaximized(false); // a closed window reopens at its normal size
    setTile(null);
    setOpen(false);
  }, [setOpen]);

  const minimize = useCallback(() => {
    closeEffectRef.current = 'genie';
    setMinimized(true);
    setOpen(false);
  }, [setOpen]);

  // Opening resets to a normal close for anything else that closes the window (Escape,
  // clicking outside, a toggle elsewhere); minimize() switches it to the genie just before.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setMinimized(false);
  }
  useEffect(() => {
    if (open) closeEffectRef.current = 'fade';
  }, [open]);

  const toggleMaximize = useCallback(() => {
    const el = windowRef.current;
    if (el) fromRect.current = el.getBoundingClientRect();
    setTile(null);
    setMaximized((v) => !v);
  }, [windowRef]);

  // Snap to a half of the screen ('left' / 'right'), or back (null); animated like zoom.
  const snapTo = useCallback((zone) => {
    const el = windowRef.current;
    if (el) fromRect.current = el.getBoundingClientRect();
    setMaximized(false);
    setTile(zone);
  }, [windowRef]);

  // Zoom: FLIP from the old box to the new one, transform-only (compositor work).
  useLayoutEffect(() => {
    const el = windowRef.current;
    const first = fromRect.current;
    fromRect.current = null;
    if (!el || !first) return;
    zoomAnim.current?.cancel();
    const last = el.getBoundingClientRect();
    if (prefersReducedMotion() || !last.width || !last.height) return;
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    const sx = first.width / last.width;
    const sy = first.height / last.height;
    const anim = el.animate(
      [
        { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transformOrigin: '0 0', transform: 'none' },
      ],
      { duration: ZOOM_MS, easing: ZOOM_EASE },
    );
    zoomAnim.current = anim;
    // Glass surfaces measure their box; re-measure once the window has settled.
    anim.finished.then(() => window.dispatchEvent(new Event('resize')), () => {});
  }, [maximized, tile, windowRef]);

  // Move, resize and snap with the pointer (windowFrame.js).
  const stateRef = useRef({ maximized, tile });
  useEffect(() => {
    stateRef.current = { maximized, tile };
  });
  useEffect(() => {
    const el = windowRef.current;
    if (!mounted || !el || !framesEnabled()) return undefined;
    // Listen on the window's overlay too: the pointer at a rounded corner, or just outside an
    // edge, is over the overlay rather than the window.
    const host = overlayRef?.current?.contains(el) ? overlayRef.current : el;
    const docked = () => stateRef.current.maximized || stateRef.current.tile;
    const inTitle = (e, rect) => el.contains(e.target) && e.clientY - rect.top <= TITLE_HEIGHT && !isNoDragTarget(e.target);

    // Resize cursor over the edges.
    const onHover = (e) => {
      if (e.buttons || document.body.classList.contains('window-dragging')) return;
      const edge = docked() ? '' : edgeAt(el.getBoundingClientRect(), e.clientX, e.clientY);
      if (edge) host.dataset.resizeEdge = edge;
      else delete host.dataset.resizeEdge;
    };
    const onLeave = () => delete host.dataset.resizeEdge;

    const onDown = (e) => {
      if (e.button !== 0) return;
      const rect = el.getBoundingClientRect();
      const edge = docked() ? '' : edgeAt(rect, e.clientX, e.clientY);
      if (!edge && !inTitle(e, rect)) return;
      e.preventDefault();
      e.stopPropagation();
      const start = { x: e.clientX, y: e.clientY, frame: frameOf(el) };
      const t = (el.style.translate || '0px 0px').split(' ').map(parseFloat);
      let translate = { x: t[0] || 0, y: t[1] || 0 };
      let moved = false;
      let zone = null;
      let frame = start.frame;
      document.body.classList.add('window-dragging');
      if (edge) document.body.dataset.resizeEdge = edge;
      // A resize that starts just outside the window is on its overlay, whose click may close
      // the window (Settings): that click is swallowed.
      if (!el.contains(e.target)) {
        const swallow = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener('click', swallow, { capture: true, once: true });
        const onUpOnce = () => setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
        window.addEventListener('pointerup', onUpOnce, { once: true });
      }

      const onMove = (ev) => {
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        if (!moved) {
          moved = true;
          // Dragging a zoomed or snapped window out: back to its own size, under the pointer.
          if (!edge && docked()) {
            const own = loadFrame(app) || { width: Math.min(rect.width, 900), height: Math.min(rect.height, 620) };
            const relX = (start.x - rect.left) / rect.width;
            const next = clampFrame({ ...own, left: start.x - own.width * relX, top: start.y - Math.min(start.y - rect.top, 20) });
            saveFrame(app, next);
            // Unzoom / unsnap now (the layout effect puts the saved frame on), then carry on.
            flushSync(() => {
              setMaximized(false);
              setTile(null);
            });
            const tr = (el.style.translate || '0px 0px').split(' ').map(parseFloat);
            translate = { x: tr[0] || 0, y: tr[1] || 0 };
            start.frame = next;
            start.x = ev.clientX;
            start.y = ev.clientY;
            frame = next;
            return;
          }
        }
        if (edge) {
          frame = resizeFrame(start.frame, edge, dx, dy);
          applyFrame(el, frame);
        } else {
          frame = { ...start.frame, left: start.frame.left + dx, top: start.frame.top + dy };
          el.style.translate = `${Math.round(translate.x + dx)}px ${Math.round(translate.y + dy)}px`;
          zone = snapZoneAt(ev.clientX, ev.clientY);
          showSnapPreview(zone);
        }
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        document.body.classList.remove('window-dragging');
        delete document.body.dataset.resizeEdge;
        showSnapPreview(null);
        if (!moved) return;
        if (zone === 'fill') {
          fromRect.current = el.getBoundingClientRect();
          setTile(null);
          setMaximized(true);
        } else if (zone) {
          snapTo(zone);
        } else {
          const kept = clampFrame(frame);
          saveFrame(app, kept);
          if (JSON.stringify(kept) !== JSON.stringify(frame)) applyFrame(el, kept);
        }
        // Glass surfaces measure where they are: re-measure once it has landed.
        window.dispatchEvent(new Event('resize'));
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };

    // Double-click the title area: zoom, as in macOS.
    const onDouble = (e) => {
      if (inTitle(e, el.getBoundingClientRect())) toggleMaximize();
    };

    host.addEventListener('pointermove', onHover);
    host.addEventListener('pointerleave', onLeave);
    host.addEventListener('pointerdown', onDown, true);
    el.addEventListener('dblclick', onDouble);
    return () => {
      host.removeEventListener('pointermove', onHover);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('dblclick', onDouble);
      delete host.dataset.resizeEdge;
    };
  }, [app, mounted, windowRef, overlayRef, snapTo, toggleMaximize]);

  // Tell the Dock whether this app is running (open or minimized).
  useEffect(() => {
    const state = mounted ? 'open' : minimized ? 'minimized' : 'closed';
    window.dispatchEvent(new CustomEvent(WINDOW_EVENT, { detail: { app, state } }));
  }, [app, mounted, minimized]);

  // Window registry: state for the menu bar, the latest controls, and front-window tracking.
  useEffect(() => {
    setWindowState(app, { state: mounted ? 'open' : minimized ? 'minimized' : 'closed', maximized });
  }, [app, mounted, minimized, maximized]);

  const controllerRef = useRef(null);
  useEffect(() => {
    controllerRef.current = { close, minimize, toggleMaximize, snapTo, tile, open: () => setOpen(true), windowRef, menus };
  });
  useEffect(() => registerController(app, controllerRef), [app]);

  useEffect(() => {
    const el = overlayRef?.current || windowRef.current;
    if (!mounted || !el) return undefined;
    const bringToFront = () => focusWindow(app);
    el.addEventListener('pointerdown', bringToFront, true);
    el.addEventListener('focusin', bringToFront);
    return () => {
      el.removeEventListener('pointerdown', bringToFront, true);
      el.removeEventListener('focusin', bringToFront);
    };
  }, [app, mounted, overlayRef, windowRef]);

  return { mounted, maximized, minimized, tile, close, minimize, toggleMaximize, snapTo };
}
