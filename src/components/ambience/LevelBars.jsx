import { useEffect, useRef } from 'react';
import { subscribeMeter } from '../../libs/ambience/store.js';

// Atmosphere's level bars (the island, the window): the real output, low to high frequencies,
// read by the shared meter (store.js) about ten times a second. Each sample writes CSS
// variables on this element only when a bar visibly moves (no React updates); the bars scale
// with a transform. Not live (paused, Sound visuals off, reduced motion, hidden page): they
// rest, still. Never a timeline: they show the sound, not a position in it.

const BAND_COUNT = 5;

export default function LevelBars({ count = 4, live = false, className = 'island-waveform' }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!live || !el) return undefined;
    const last = new Array(count).fill(-1);
    // Which of the five bands each bar shows (spread over the range).
    const pick = Array.from({ length: count }, (_, i) => Math.round((i * (BAND_COUNT - 1)) / Math.max(1, count - 1)));
    const off = subscribeMeter(({ bands }) => {
      for (let i = 0; i < count; i += 1) {
        const v = bands[pick[i]] ?? 0;
        if (Math.abs(v - last[i]) < 0.04) continue;
        last[i] = v;
        el.style.setProperty(`--l${i}`, v.toFixed(2));
      }
    });
    return () => {
      off();
      for (let i = 0; i < count; i += 1) el.style.removeProperty(`--l${i}`);
    };
  }, [live, count]);

  return (
    <div ref={ref} className={`${className} atm-levels${live ? ' is-live' : ''}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => <span key={i} className="wave-bar" />)}
    </div>
  );
}
