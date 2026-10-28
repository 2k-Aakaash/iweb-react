import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGenie } from '../genie/useGenie';
import { prefersReducedMotion } from '../genie/genie';
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
// Opening from the Dock always genies out of the icon. Each app reports its state on the
// `iweb:window` event so the Dock can show its running dot.

const ZOOM_MS = 460;
const ZOOM_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'; // fast start, long soft settle (macOS-like)

export const WINDOW_EVENT = 'iweb:window';

export function useMacWindow({ app, open, setOpen, windowRef, overlayRef }) {
  const closeEffectRef = useRef('genie');
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const fromRect = useRef(null);
  const zoomAnim = useRef(null);

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
    setMaximized((v) => !v);
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
  }, [maximized, windowRef]);

  // Tell the Dock whether this app is running (open or minimized).
  useEffect(() => {
    const state = mounted ? 'open' : minimized ? 'minimized' : 'closed';
    window.dispatchEvent(new CustomEvent(WINDOW_EVENT, { detail: { app, state } }));
  }, [app, mounted, minimized]);

  return { mounted, maximized, minimized, close, minimize, toggleMaximize };
}
