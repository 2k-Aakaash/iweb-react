import { useEffect, useRef } from 'react';
import gsap from 'gsap';

// Expand / collapse behaviour shared by the Smart Stack cards (currency, gold & silver; the
// Weather card uses morphCard too), plus "click outside to collapse".
//
//   cardRef      the card element (collapsed size from CSS: --widget-w × 150)
//   panelRefs    sections shown only when expanded (display: flex)
//   dividerRef   optional hairline between sections (display: block)

export const COLLAPSED_SIZE = 150;
export const EXPANDED_WIDTH = 320;

/** The card's collapsed width: --widget-w from the desktop item (small or medium size). */
export function collapsedWidth(card) {
  const value = parseFloat(getComputedStyle(card).getPropertyValue('--widget-w'));
  return Number.isFinite(value) && value > 0 ? value : COLLAPSED_SIZE;
}
const MOBILE_QUERY = '(max-width: 480px)';

// How a card opens and closes, after macOS 26's widgets: the frame glides to its exact final
// size on one smooth, settling curve (no jump at the end, no overshoot), the extra content
// fades in once there's room for it, and on close fades out first while the frame shrinks
// back around it (clipped, never squashed).
const FRAME_EASE = 'expo.out';
const FRAME_S = 0.5;
const CLOSE_EASE = 'power3.inOut';
const CLOSE_S = 0.4;

/**
 * Animates `card` open or closed. The final size is measured before anything moves (the
 * end state is laid out once, read, and put back), so the frame lands exactly on it.
 *
 *   sections   elements shown only when open: { el, display } (display: 'flex', 'block', …)
 *   width      open width (px or '100%'); open padding is 16, closed 12 and 150 tall
 *   tweens     other elements that change with it: { el, open: {…}, closed: {…} }, GSAP vars
 *   instant    no animation (reduced motion)
 */
// The card's height while it's open, kept up to date (its content can change while open), so
// closing starts from what's on screen rather than from the re-rendered, closed-state layout.
const openHeights = new WeakMap();
const watchers = new WeakMap();
function watchOpenHeight(card, on) {
  watchers.get(card)?.disconnect();
  watchers.delete(card);
  if (!on || typeof ResizeObserver === 'undefined') return;
  const ro = new ResizeObserver(() => openHeights.set(card, card.offsetHeight));
  ro.observe(card);
  watchers.set(card, ro);
}

// Reads the layout as it will be once the CSS transitions now starting (font sizes that
// follow the open class) have finished, then puts them back where they were.
function measureSettled(card, read) {
  const running = card.getAnimations?.({ subtree: true }).filter((a) => {
    const end = a.effect?.getComputedTiming?.().endTime;
    return a.playState === 'running' && Number.isFinite(end);
  }) ?? [];
  const saved = running.map((a) => a.currentTime);
  running.forEach((a) => { a.currentTime = a.effect.getComputedTiming().endTime - 1; });
  const value = read();
  running.forEach((a, i) => { a.currentTime = saved[i]; });
  return value;
}

export function morphCard(card, open, { sections, width, tweens = [], instant = false }) {
  const els = sections.map((s) => s.el);
  gsap.killTweensOf([card, ...els, ...tweens.map((t) => t.el)]);
  watchOpenHeight(card, false);
  const done = () => {
    card.classList.remove('is-morphing');
    if (open) {
      gsap.set(card, { height: 'auto', clearProps: 'overflow' }); // follows its content
      openHeights.set(card, card.offsetHeight);
      watchOpenHeight(card, true);
    } else {
      gsap.set(els, { display: 'none', clearProps: 'height,opacity,y' });
      gsap.set(card, { clearProps: 'width,height,padding,overflow' }); // CSS size again
    }
  };

  if (open) {
    const from = { width: card.offsetWidth, height: card.offsetHeight };
    const fromVars = tweens.map((t) => Object.fromEntries(Object.keys(t.open).map((k) => [k, gsap.getProperty(t.el, k)])));
    // Lay out the open state once to measure it.
    sections.forEach((s) => gsap.set(s.el, { display: s.display, height: 'auto', opacity: 0, y: 0 }));
    tweens.forEach((t) => gsap.set(t.el, t.open));
    gsap.set(card, { width, height: 'auto', padding: 16 });
    const to = measureSettled(card, () => ({ width: card.offsetWidth, height: card.offsetHeight }));
    if (instant) {
      gsap.set(els, { opacity: (i) => sections[i].opacity ?? 1 });
      done();
      return;
    }
    tweens.forEach((t, i) => gsap.set(t.el, fromVars[i]));
    card.classList.add('is-morphing'); // its rows keep their size and are clipped, not squashed
    gsap.set(card, { ...from, padding: 12, overflow: 'hidden' });
    const tl = gsap.timeline({ defaults: { ease: FRAME_EASE, duration: FRAME_S } });
    tl.to(card, { ...to, padding: 16, onComplete: done }, 0);
    tweens.forEach((t) => tl.to(t.el, t.open, 0));
    sections.forEach((s) => {
      tl.fromTo(s.el, { y: 8 }, { opacity: s.opacity ?? 1, y: 0, duration: 0.32, ease: 'power2.out' }, 0.1);
    });
    return;
  }

  if (instant) {
    tweens.forEach((t) => gsap.set(t.el, t.closed));
    done();
    return;
  }
  // The frame shrinks around the (fading) content, which keeps its layout until it's gone.
  const narrow = width === '100%' ? '100%' : collapsedWidth(card);
  card.classList.add('is-morphing');
  gsap.set(card, { height: openHeights.get(card) ?? card.offsetHeight, overflow: 'hidden' });
  const tl = gsap.timeline({ defaults: { ease: CLOSE_EASE, duration: CLOSE_S } });
  tl.to(els, { opacity: 0, duration: 0.14, ease: 'power1.in' }, 0)
    .to(card, { width: narrow, height: COLLAPSED_SIZE, padding: 12, onComplete: done }, 0);
  tweens.forEach((t) => tl.to(t.el, t.closed, 0));
}

export function useCardExpand({ isExpanded, onCollapse, cardRef, panelRefs, dividerRef, expandedWidth = EXPANDED_WIDTH }) {
  const lastExpandedRef = useRef(false);
  // Latest options, so callers may pass inline arrays/callbacks without re-running effects
  // (re-running the cleanup effect mid-animation would kill the running tween).
  const optionsRef = useRef({ onCollapse, panelRefs, dividerRef, expandedWidth });

  useEffect(() => {
    optionsRef.current = { onCollapse, panelRefs, dividerRef, expandedWidth };
  });

  const getSections = () => {
    const { panelRefs: panelList, dividerRef: dividerHandle } = optionsRef.current;
    const panels = panelList.map((ref) => ref.current).filter(Boolean);
    const divider = dividerHandle?.current || null;
    return { panels, divider };
  };

  // Collapse when clicking anywhere outside the expanded card.
  useEffect(() => {
    if (!isExpanded) return undefined;
    const handlePointerDown = (e) => {
      if (cardRef.current && !cardRef.current.contains(e.target)) optionsRef.current.onCollapse?.();
    };
    // Esc collapses even when the card was opened with the mouse and holds no focus
    // (cards handle Esc themselves when focused, and stop it there).
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) optionsRef.current.onCollapse?.();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isExpanded, cardRef]);

  useEffect(() => {
    const card = cardRef.current;
    const { panels, divider } = getSections();
    if (!card || !panels.length) return undefined;
    if (lastExpandedRef.current === isExpanded) return undefined;
    lastExpandedRef.current = isExpanded;

    const mobile = window.matchMedia(MOBILE_QUERY).matches;
    morphCard(card, isExpanded, {
      sections: [
        ...panels.map((el) => ({ el, display: 'flex' })),
        ...(divider ? [{ el: divider, display: 'block', opacity: 0.5 }] : []),
      ],
      width: mobile ? '100%' : Math.max(optionsRef.current.expandedWidth, collapsedWidth(card)),
      instant: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the expanded state drives the animation
  }, [isExpanded]);

  // Kill any running tween if the card unmounts mid-animation (elements captured at mount).
  useEffect(() => {
    const card = cardRef.current;
    const { panels, divider } = getSections();
    const elements = [card, ...panels, divider].filter(Boolean);
    return () => gsap.killTweensOf(elements);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only
  }, []);
}
