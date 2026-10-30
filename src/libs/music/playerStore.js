// What iWeb Music is playing, for anything outside the Music app (Control Center's Now Playing
// and Sound). Music.jsx publishes its state here on every render and registers a controller
// (a ref, so it always holds the latest handlers) that the commands below call.
//
// State: { available, track: { title, artist, artwork } | null, playing, volume (0–100),
//          muted, outputId }
import { useSyncExternalStore } from 'react';

const INITIAL = Object.freeze({ available: false, track: null, playing: false, volume: 80, muted: false, outputId: '' });

let state = INITIAL;
let controller = null;
const listeners = new Set();

const sameTrack = (a, b) => a === b || (a && b && a.title === b.title && a.artist === b.artist && a.artwork === b.artwork);

/** Music reports its state (only real changes notify). */
export function publishPlayer(next) {
  const merged = { ...state, ...next };
  if (sameTrack(merged.track, state.track)) merged.track = state.track;
  if (Object.keys(merged).every((k) => merged[k] === state[k])) return;
  state = merged;
  for (const listener of [...listeners]) listener();
}

export function registerPlayerController(ref) {
  controller = ref;
  return () => {
    if (controller === ref) controller = null;
  };
}

const call = (name, ...args) => controller?.current?.[name]?.(...args);

export const playPause = () => call('playPause');
export const nextTrack = () => call('next');
export const previousTrack = () => call('previous');
export const setPlayerVolume = (volume) => call('setVolume', Math.round(Math.min(100, Math.max(0, volume))));
export const toggleMute = () => call('toggleMute');
export const openMusic = () => call('open');
/** Plays through an audio output (a deviceId from enumerateDevices); resolves true on success. */
export const setOutputDevice = async (deviceId) => Boolean(await call('setOutput', deviceId));

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getPlayer = () => state;

export function usePlayer() {
  return useSyncExternalStore(subscribe, getPlayer, getPlayer);
}
