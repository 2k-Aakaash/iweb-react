import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createGenie, prefersReducedMotion, targetRect } from './genie';
import { warmBackdrop } from './backdrop';

/**
 * Keeps a modal mounted while it genies out of / into a dock icon.
 *
 *   const mounted = useGenie(isOpen, { target: '[data-action="notes"]', windowRef, overlayRef });
 *   if (!mounted) return null;
 *
 * Opening plays the effect in reverse out of the target; closing plays it into the target and
 * only then reports mounted = false. Toggling mid-run reverses from the current position.
 * With prefers-reduced-motion the modal mounts and unmounts immediately (its CSS fade remains).
 *
 * `closeEffectRef.current` (optional) picks how a close plays: 'genie' (minimize, the default)
 * or 'fade' (macOS close: a quick fade and shrink, no genie).
 */
const FADE_MS = 180;

export function useGenie(open, { target, windowRef, overlayRef, closeEffectRef }) {
  const [mounted, setMounted] = useState(open);
  const genieRef = useRef(null);
  const [reduced] = useState(prefersReducedMotion);

  // Mount immediately on open; with reduced motion also unmount immediately on close.
  // (Adjusting state while rendering, as React recommends over an effect.)
  if (open && !mounted) setMounted(true);
  if (reduced && !open && mounted) setMounted(false);

  useLayoutEffect(() => {
    if (!mounted || reduced) return undefined;

    const el = windowRef.current;
    if (!el) {
      if (!open) queueMicrotask(() => setMounted(false));
      return undefined;
    }

    el.classList.add('genie-managed');
    overlayRef?.current?.classList.add('genie-managed');

    // macOS close: fade and shrink in place, then unmount.
    if (!open && closeEffectRef?.current === 'fade' && !genieRef.current) {
      const overlay = overlayRef?.current;
      const easing = 'cubic-bezier(0.4, 0, 1, 1)';
      const win = el.animate(
        [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.96)' }],
        { duration: FADE_MS, easing, fill: 'forwards' },
      );
      const dim = overlay?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing, fill: 'forwards' });
      let current = true;
      win.finished.then(() => {
        if (current) setMounted(false);
      }, () => {});
      return () => {
        // Reopened mid-fade (or unmounting): drop the fade and show the window again.
        current = false;
        win.cancel();
        dim?.cancel();
      };
    }

    if (!genieRef.current) {
      genieRef.current = createGenie(el, {
        getTarget: () => targetRect(target),
        overlay: overlayRef?.current ?? null,
      });
    }
    const genie = genieRef.current;
    let current = true;
    genie.play(open ? 0 : 1).then((result) => {
      // Restored (0): the controller cross-fades back to the live window by itself.
      if (!current || result !== 1) return;
      genie.destroy();
      genieRef.current = null;
      setMounted(false);
    });
    return () => {
      current = false;
    };
  }, [open, mounted, reduced, target, windowRef, overlayRef, closeEffectRef]);

  // Decode the wallpaper early so the first run already has the glass backdrop, and never
  // leave strips behind if the component unmounts mid-run.
  useEffect(() => {
    if (!reduced) warmBackdrop();
    return () => genieRef.current?.destroy();
  }, [reduced]);

  return mounted;
}
