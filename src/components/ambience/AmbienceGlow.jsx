import { useEffect, useRef, useState } from 'react';
import { subscribeMeter, useAmbience } from '../../libs/ambience/store.js';
import { environmentById } from '../../libs/ambience/environments/index.js';
import '../../styles/ambience-glow.css';

// The Siri-like edge glow while Atmosphere plays (styles/ambience-glow.css). Mounted only while
// playing (and for its fade-out after), so nothing of it exists otherwise. Its colours are the
// environment's (low-saturation; they cross-fade when the environment changes).
//
// "Follows the sound": the real output level from the shared meter (store.js: ~10 Hz, only
// while playing, visible and not reduced-motion), smoothed and written straight to a CSS
// variable when it visibly changes (no React updates).

const FADE_OUT_MS = 1500;

export default function AmbienceGlow() {
  const state = useAmbience();
  const on = state.status === 'playing' && state.glow.enabled;
  const [shown, setShown] = useState(on);
  if (on && !shown) setShown(true); // appear at once (adjusted while rendering)
  const ref = useRef(null);
  const colors = environmentById(state.environmentId)?.glow || [];

  // Fade out, then unmount.
  useEffect(() => {
    if (on || !shown) return undefined;
    const t = setTimeout(() => setShown(false), FADE_OUT_MS);
    return () => clearTimeout(t);
  }, [on, shown]);

  const reactive = on && state.glow.reactive;
  useEffect(() => {
    const el = ref.current;
    if (!reactive || !el) return undefined;
    let level = 0;
    let written = -1;
    const off = subscribeMeter(({ energy }) => {
      level = level * 0.75 + energy * 0.25; // smooth: no flicker
      // Only a visible change is written (each write restyles the glow).
      if (Math.abs(level - written) < 0.03) return;
      written = level;
      el.style.setProperty('--ambience-energy', level.toFixed(2));
    });
    return () => {
      off();
      el.style.removeProperty('--ambience-energy');
    };
  }, [reactive, shown]);

  if (!shown) return null;
  return (
    <div
      ref={ref}
      className={`ambience-glow${on ? ' is-on' : ''}`}
      style={{ '--glow-a': colors[0], '--glow-b': colors[1], '--glow-c': colors[2] }}
      aria-hidden="true"
    />
  );
}
