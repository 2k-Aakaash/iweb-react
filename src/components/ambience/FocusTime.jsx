import { useTicker } from '../../libs/controlcenter/timer';
import { getAmbience } from '../../libs/ambience/store.js';

// A focus session's time left, as text (the island, the window). Only this small element
// re-renders while the session runs (once a second, or every ten seconds when compact).

/** "24:05" (precise) or "24 min" / "<1 min" (compact). */
function formatLeft(ms, compact) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (compact) return s < 60 ? '<1 min' : `${Math.ceil(s / 60)} min`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export default function FocusTime({ focus, compact = false, className = '' }) {
  const running = focus?.status === 'running';
  useTicker(running, compact ? 10000 : 1000);
  if (!focus) return null;
  const left = getAmbience().focusRemaining(focus);
  return (
    <span className={className} role="timer" aria-label={`Focus session: ${formatLeft(left, true)} left${running ? '' : ', paused'}`}>
      {formatLeft(left, compact)}
    </span>
  );
}
