import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createGenie, prefersReducedMotion, targetRect } from './genie';
import { warmBackdrop } from './backdrop';
import { usePref } from '../prefs/storedPref.js';
import { windowGeniePref } from '../dock/dockPrefs.js';

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
 *
 * With the genie turned off (Settings → Dock, windowGeniePref) opening and minimising use the
 * Scale effect instead: the live window scales to and from the icon (transform and opacity
 * only, on the compositor), with no copies of the window and no wallpaper still.
 */
const FADE_MS = 180;
const SCALE_MS = 260;
const SCALE_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

// The transform that puts the window `r` on the icon `to`: uniformly scaled, centred on it.
function onIcon(r, to) {
  const s = Math.max(0.02, Math.min((to.right - to.left) / r.width, (to.bottom - to.top) / r.height));
  const dx = (to.left + to.right) / 2 - (r.left + (r.width * s) / 2);
  const dy = (to.top + to.bottom) / 2 - (r.top + (r.height * s) / 2);
  return `translate(${dx}px, ${dy}px) scale(${s})`;
}

export function useGenie(open, { target, windowRef, overlayRef, closeEffectRef }) {
  const [mounted, setMounted] = useState(open);
  const genieRef = useRef(null);
  const [reduced] = useState(prefersReducedMotion);
  // Read when a run starts (switching it while a window is open mustn't replay its opening).
  const genieOn = usePref(windowGeniePref);
  const genieOnRef = useRef(genieOn);
  genieOnRef.current = genieOn; // eslint-disable-line react-hooks/refs
  const scaleFrom = useRef(null); // where an interrupted scale run had got to

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

    // Scale effect (genie off): the window itself scales out of / into the icon.
    if (!genieOnRef.current) {
      genieRef.current?.destroy(); // switched off since the last run
      genieRef.current = null;
      const overlay = overlayRef?.current;
      // Measured without a transform (an interrupted run is cancelled first).
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) {
        if (!open) queueMicrotask(() => setMounted(false));
        return undefined;
      }
      const icon = { transform: onIcon(r, targetRect(target)), opacity: 0 };
      const shown = { transform: 'none', opacity: 1 };
      const start = scaleFrom.current ?? (open ? icon : shown);
      scaleFrom.current = null;
      const opts = { duration: SCALE_MS, easing: SCALE_EASE, fill: 'forwards' };
      const win = el.animate([{ transformOrigin: '0 0', ...start }, { transformOrigin: '0 0', ...(open ? shown : icon) }], opts);
      const dim = overlay?.animate([{ opacity: start.opacity }, { opacity: open ? 1 : 0 }], opts);
      let current = true;
      win.finished.then(() => {
        if (!current) return;
        if (open) {
          // Done: drop the fill so the window is plain again (its glass re-measures).
          win.cancel();
          dim?.cancel();
          window.dispatchEvent(new Event('resize'));
        } else setMounted(false);
      }, () => {});
      return () => {
        current = false;
        if (win.playState === 'running') {
          // Reversed mid-run: the next run starts from here.
          const cs = getComputedStyle(el);
          scaleFrom.current = { transform: cs.transform === 'none' ? 'none' : cs.transform, opacity: Number(cs.opacity) };
        }
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

  // Decode the wallpaper early so the first run already has the glass backdrop (not needed
  // for the Scale effect).
  useEffect(() => {
    if (!reduced && genieOn) warmBackdrop();
  }, [reduced, genieOn]);

  // Never leave strips behind if the component unmounts mid-run.
  useEffect(() => {
    return () => {
      // Forget it too: a destroyed controller ignores play(), and reusing it (after React's
      // dev double-mount of a window that mounts open, e.g. Markets) left the window hidden.
      genieRef.current?.destroy();
      genieRef.current = null;
    };
  }, []);

  return mounted;
}
