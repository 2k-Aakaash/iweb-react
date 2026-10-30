import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import GlassSurface from '../glass/GlassSurface';
import { TimerIcon } from './ccIcons';
import { finishTimer, formatRemaining, isActive, isRunning, playChime, remainingAt, useTicker, useTimer } from '../../libs/controlcenter/timer';
import { OPEN_CONTROL_CENTER } from '../../libs/controlcenter/controls';
import '../../styles/controlcenter.css';

// The running timer, beside the Dynamic Island as a second activity on iPhone: a round bubble
// to the island's right while music has the island, or a pill of its own at the top centre.
// A ring shows what's left; it chimes in the tab you're looking at when it ends. Click to
// open the timer in Control Center.

function useIslandRect(active) {
  const [rect, setRect] = useState(null);
  useLayoutEffect(() => {
    if (!active) return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const pill = document.getElementById('island-pill');
      const r = pill?.getBoundingClientRect();
      const next = r && r.width ? { right: Math.round(r.right), top: Math.round(r.top), height: Math.round(r.height) } : null;
      setRect((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    // The island grows on hover and appears once music is chosen: follow both.
    const resize = new ResizeObserver(schedule);
    const watch = () => {
      const pill = document.getElementById('island-pill');
      resize.disconnect();
      if (pill) resize.observe(pill);
      schedule();
    };
    watch();
    const mutations = new MutationObserver(watch);
    mutations.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [active]);
  return rect;
}

export default function TimerBubble() {
  const timer = useTimer();
  const active = isActive(timer);
  const now = useTicker(isRunning(timer), 250);
  const left = remainingAt(timer, now);
  const island = useIslandRect(active);

  // Reaching zero ends it (in whichever tab notices first)…
  useEffect(() => {
    if (isRunning(timer) && left <= 0) finishTimer();
  }, [timer, left]);
  // …and the tab in view rings.
  const wasDone = useRef(timer.done);
  useEffect(() => {
    if (timer.done && !wasDone.current && document.visibilityState === 'visible') playChime();
    wasDone.current = timer.done;
  }, [timer.done]);

  if (!active) return null;
  const R = 15;
  const C = 2 * Math.PI * R;
  const progress = timer.done ? 0 : left / timer.duration;
  const beside = island !== null;
  const style = beside ? { left: island.right + 8, top: island.top, height: island.height } : undefined;
  const open = () => window.dispatchEvent(new CustomEvent(OPEN_CONTROL_CENTER, { detail: { view: 'timer' } }));

  return createPortal(
    <button
      type="button"
      className={`cc-timer-bubble glass-host${beside ? ' is-beside' : ''}${timer.done ? ' is-done' : ''}${isRunning(timer) ? '' : ' is-paused'}`}
      style={style}
      onClick={open}
      aria-label={timer.done ? 'Timer ended. Open the timer.' : `Timer, ${formatRemaining(left)} left. Open the timer.`}
    >
      <GlassSurface preset="pill" />
      <span className="cc-bubble-ring" aria-hidden="true">
        <svg viewBox="0 0 36 36">
          <circle cx="18" cy="18" r={R} className="cc-bubble-track" />
          <circle cx="18" cy="18" r={R} className="cc-bubble-fill" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} />
        </svg>
        <TimerIcon size={13} />
      </span>
      {!beside || timer.done ? <span className="cc-bubble-time">{timer.done ? 'Timer' : formatRemaining(left)}</span> : null}
      {beside && !timer.done && <span className="cc-bubble-time is-compact">{formatRemaining(left)}</span>}
    </button>,
    document.body,
  );
}
