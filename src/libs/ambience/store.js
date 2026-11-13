// The page's one Atmosphere engine (made on first use; making it creates no audio: that waits
// for Play) and the React hooks that read it. The engine is the single source of truth: the
// Atmosphere window, the Dynamic Island and the edge glow all show the same state.
//
// Also the one meter: the edge glow and the island's level bars read the real output through
// a single ~10 Hz sampler, which runs only while something is listening, Atmosphere is
// playing, the page is visible and motion isn't reduced. Listeners write CSS variables
// themselves, so a sample never re-renders React.
import { useSyncExternalStore } from 'react';
import { AmbienceEngine } from './engine.js';
import { ambienceScenesPref } from './prefs.js';
import { BUILT_IN_SCENES, findScene } from './scenes.js';
import { environmentById } from './environments/index.js';
import { usePref } from '../prefs/storedPref.js';
import { notify } from '../notifications/notifications.js';

let engine = null;

/** The engine (one per page). */
export function getAmbience() {
  if (!engine) {
    engine = new AmbienceEngine({
      onEvent: (e) => {
        if (e.type !== 'focus-complete') return;
        const scene = findScene(e.sceneId, ambienceScenesPref.get() || []);
        const name = scene?.name || environmentById(e.environmentId)?.name || 'Atmosphere';
        notify({ app: 'atmosphere', title: 'Focus session complete', body: `${e.minutes} min with ${name}.`, key: 'atmosphere-focus' });
      },
    });
  }
  return engine;
}

const subscribe = (l) => getAmbience().subscribe(l);
const snapshot = () => getAmbience().getState();

/** Atmosphere's state: status, environment, scene, volumes, parameters, timers, options. */
export function useAmbience() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The user's scenes. */
export const useAmbienceScenes = () => usePref(ambienceScenesPref);
export const useAmbiencePresets = useAmbienceScenes;

/** The scene now playing (built-in or the user's), or null. */
export function currentScene(state, custom = ambienceScenesPref.get() || []) {
  const scene = findScene(state.sceneId, custom);
  return scene && scene.environmentId === state.environmentId ? scene : null;
}

export { BUILT_IN_SCENES };

// ---- the meter -------------------------------------------------------------------------

const METER_MS = 100;
const meterListeners = new Set();
let meterTimer = 0;
let meterWired = false;

const reducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

function sampleMeter() {
  const m = getAmbience().meter();
  if (!m) return;
  for (const l of [...meterListeners]) l(m);
}

function syncMeter() {
  const e = getAmbience();
  const want = meterListeners.size > 0
    && e.getState().status === 'playing'
    && !(typeof document !== 'undefined' && document.hidden)
    && !reducedMotion();
  if (want && !meterTimer) {
    meterTimer = setInterval(sampleMeter, METER_MS);
  } else if (!want && meterTimer) {
    clearInterval(meterTimer);
    meterTimer = 0;
    e.releaseMeter();
  }
}

/**
 * Listens to the sound's level ({ energy, bands }) about ten times a second, only while it
 * can be seen. Returns the unsubscribe.
 */
export function subscribeMeter(listener) {
  if (!meterWired) {
    meterWired = true;
    getAmbience().subscribe(syncMeter);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', syncMeter);
  }
  meterListeners.add(listener);
  syncMeter();
  return () => {
    meterListeners.delete(listener);
    syncMeter();
  };
}

/** For diagnostics: is the meter sampling? */
export const meterRunning = () => Boolean(meterTimer);

// ---- events ----------------------------------------------------------------------------

// Opening the Atmosphere window (App.jsx listens). `tab`: 'explore' | 'customize' | 'experience'.
export const ATMOSPHERE_OPEN_EVENT = 'atmosphere:open';
export const openAtmosphere = (tab) => window.dispatchEvent(new CustomEvent(ATMOSPHERE_OPEN_EVENT, tab ? { detail: { tab } } : undefined));

// A suggestion's action (a notification click: a user gesture, so it may start the sound).
export const ATMOSPHERE_SCENE_EVENT = 'atmosphere:scene';

// Opening the Frontier World window (App.jsx listens): the island, Apps, the Dock and
// Atmosphere's Frontier tab.
export const FRONTIER_OPEN_EVENT = 'frontier:open';
export const openFrontier = () => window.dispatchEvent(new CustomEvent(FRONTIER_OPEN_EVENT));

/** For tests: forget the engine. */
export function _resetAmbience() {
  engine?.dispose();
  engine = null;
  clearInterval(meterTimer);
  meterTimer = 0;
  meterWired = false;
  meterListeners.clear();
}
