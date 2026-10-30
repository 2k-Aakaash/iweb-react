import { useEffect, useRef } from 'react';
import gsap from 'gsap';

// Expand / collapse behaviour shared by the Smart Stack cards (currency, gold & silver):
// the same GSAP timeline values as the Weather card, plus "click outside to collapse".
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
// The weather card's timeline passes a CSS cubic-bezier() string, which GSAP core can't
// parse and resolves to its default 'power1.out'; use that so all cards move the same.
const EXPAND_EASE = 'power1.out';
const COLLAPSE_EASE = 'power2.inOut';

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
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sections = divider ? [...panels, divider] : panels;
    // Callbacks live on the tweens (not the timeline) so a quick re-toggle that kills
    // them can never fire a stale one.
    const hideSections = () => gsap.set(sections, { display: 'none', height: 0, opacity: 0 });
    const restoreCollapsedSize = () => gsap.set(card, { clearProps: 'width,height,padding' });
    gsap.killTweensOf([card, ...sections]);

    if (isExpanded) {
      gsap.set(panels, { display: 'flex' });
      if (divider) gsap.set(divider, { display: 'block' });
      // The card's height follows its content (min-height 150px) while the sections open,
      // so it grows smoothly and ends at the real height without a jump.
      gsap.set(card, { height: 'auto' });
      const cardTo = { width: mobile ? '100%' : Math.max(optionsRef.current.expandedWidth, collapsedWidth(card)), padding: 16 };
      if (reducedMotion) {
        gsap.set(card, cardTo);
        gsap.set(panels, { height: 'auto', opacity: 1 });
        if (divider) gsap.set(divider, { height: 1, opacity: 0.5 });
        return undefined;
      }
      const timeline = gsap.timeline({ defaults: { ease: EXPAND_EASE } })
        .to(card, { ...cardTo, duration: 0.38 }, 0);
      panels.forEach((panel, index) => {
        timeline.to(panel, { height: 'auto', opacity: 1, duration: index === 0 ? 0.32 : 0.35 }, 0.03);
      });
      if (divider) timeline.to(divider, { height: 1, opacity: 0.5, duration: 0.25 }, 0.03);
      return undefined;
    }

    // Collapsed size comes from CSS (150×150, full width on phones) once the tween ends.
    if (reducedMotion) {
      hideSections();
      restoreCollapsedSize();
      return undefined;
    }
    gsap.timeline({ defaults: { ease: COLLAPSE_EASE } })
      .to(sections, { height: 0, opacity: 0, duration: 0.22, onComplete: hideSections }, 0)
      .to(card, {
        width: mobile ? '100%' : collapsedWidth(card),
        height: COLLAPSED_SIZE,
        padding: 12,
        duration: 0.28,
        onComplete: restoreCollapsedSize,
      }, 0);
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
