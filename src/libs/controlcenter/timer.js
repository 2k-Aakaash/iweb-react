// Control Center's timer: a countdown shown beside the Dynamic Island (TimerBubble.jsx), like
// a timer on iPhone. Kept in localStorage so every iWeb tab shows the same timer; only the
// tab in view rings when it ends.
//
// State: { duration, endsAt, remaining, done }
//   running  endsAt is set (a time), remaining null
//   paused   endsAt null, remaining the ms left
//   done     the countdown reached zero and nobody has dismissed it yet
import { useEffect, useState, useSyncExternalStore } from 'react';

const KEY = 'iweb:timer';
export const IDLE = Object.freeze({ duration: 0, endsAt: null, remaining: null, done: false });
export const PRESETS_MIN = Object.freeze([1, 3, 5, 10, 15, 25, 30, 60]);
export const MAX_MINUTES = 24 * 60 - 1;

/** A valid timer state from anything stored (IDLE when broken). */
export function normalizeTimer(raw) {
  if (!raw || typeof raw !== 'object' || !(raw.duration > 0)) return IDLE;
  const endsAt = Number.isFinite(raw.endsAt) ? raw.endsAt : null;
  const remaining = Number.isFinite(raw.remaining) ? Math.max(0, raw.remaining) : null;
  if (endsAt === null && remaining === null && !raw.done) return IDLE;
  return { duration: raw.duration, endsAt, remaining: endsAt === null ? remaining : null, done: Boolean(raw.done) };
}

export const isActive = (t) => t.duration > 0;
export const isRunning = (t) => t.endsAt !== null && !t.done;

/** Milliseconds left at `now`. */
export function remainingAt(t, now) {
  if (!isActive(t) || t.done) return 0;
  return t.endsAt !== null ? Math.max(0, t.endsAt - now) : t.remaining;
}

/** 1:05:09, 4:09, 0:07: what's left, rounded up to the second. */
export function formatRemaining(ms) {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// ---- The shared timer ---------------------------------------------------------------------

function read() {
  try {
    return normalizeTimer(JSON.parse(localStorage.getItem(KEY) || 'null'));
  } catch {
    return IDLE;
  }
}

let state = typeof localStorage === 'undefined' ? IDLE : read();
const listeners = new Set();
const emit = () => {
  for (const listener of [...listeners]) listener();
};

function save(next) {
  state = next;
  try {
    if (isActive(next)) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: this tab only.
  }
  emit();
}

export const getTimer = () => state;

export function startTimer(ms, now = Date.now()) {
  if (!(ms > 0)) return;
  save({ duration: ms, endsAt: now + ms, remaining: null, done: false });
}

export function pauseTimer(now = Date.now()) {
  if (!isRunning(state)) return;
  save({ ...state, endsAt: null, remaining: remainingAt(state, now) });
}

export function resumeTimer(now = Date.now()) {
  if (isRunning(state) || state.done || !isActive(state)) return;
  save({ ...state, endsAt: now + state.remaining, remaining: null });
}

export function cancelTimer() {
  save(IDLE);
}

/** The countdown reached zero: returns true when this call ended it (so this tab rings). */
export function finishTimer() {
  if (!isRunning(state)) return false;
  save({ ...state, endsAt: null, remaining: 0, done: true });
  return true;
}

let storageAttached = false;
function subscribe(listener) {
  listeners.add(listener);
  if (!storageAttached && typeof window !== 'undefined') {
    storageAttached = true;
    window.addEventListener('storage', (e) => {
      if (e.key !== KEY && e.key !== null) return;
      state = read();
      emit();
    });
  }
  return () => listeners.delete(listener);
}

export function useTimer() {
  return useSyncExternalStore(subscribe, getTimer, getTimer);
}

/** The time now, updated every `ms` while `active` (a running countdown). */
export function useTicker(active, ms = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

/** A soft three-note chime (Web Audio, no file). */
export function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const notes = [880, 1174.66, 1567.98];
    notes.forEach((freq, i) => {
      for (const repeat of [0, 1.2]) {
        const t = ctx.currentTime + repeat + i * 0.16;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.95);
      }
    });
    setTimeout(() => ctx.close(), 3000);
  } catch {
    // No audio: the bubble still shows the timer ended.
  }
}
