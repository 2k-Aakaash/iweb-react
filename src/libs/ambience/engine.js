// The Atmosphere engine: procedural ambience with the Web Audio API. One engine per tab; it
// owns the only AudioContext and is the single source of truth for playback state (the
// Atmosphere window, the Dynamic Island and the edge glow all read it through store.js).
//
//   graph     environment layers (level → evolution → stereo panner) → environment output →
//             master → sleep fade → focus fade → limiter → out, with one shared reverb (a
//             generated impulse) and one shared delay
//   lifecycle nothing is created until the first Play (a user gesture). Pause fades out and
//             suspends the context; Stop also disposes the environment's nodes. Switching
//             environments (or applying a scene in another one) crossfades and then disposes
//             the old one.
//   timing    events are scheduled a little ahead on the audio clock by a 250 ms ticker that
//             runs only while playing (a longer window while the tab is hidden, where timers
//             slow down). Continuous layers need no scheduling at all. Evolution steps
//             (evolution.js) ride the same ticker: one at most per tick, minutes apart, so a
//             hidden or suspended tab never builds up a backlog.
//   safety    repeated clicks share one pending start; only one iWeb tab plays at a time; every
//             gain change is a ramp (no clicks); a limiter keeps peaks down.
import { environmentById, nextEnvironmentId, validEnvironment } from './environments/index.js';
import { createKit, glide, impulseResponse } from './voices.js';
import { newSeed, seeded } from './random.js';
import { EVOLUTION_MODES, effectiveParams, evolutionStep, firstWait, profileOf, startLevels } from './evolution.js';
import { findScene, normalizeScene } from './scenes.js';
import { ambienceScenesPref, ambienceSettingsPref, normalizeSettings, PARAMS, SLEEP_OPTIONS, validFocusMinutes } from './prefs.js';

const TICK_MS = 250;
const LOOKAHEAD = 0.9; // seconds scheduled ahead while visible
const LOOKAHEAD_HIDDEN = 3.5; // hidden tabs run timers about once a second
const ENV_FADE_TC = 0.8; // environment crossfade time constant (≈ 2.5 s to settle)
const SCENE_TC = 1.2; // a scene's layers move over ≈ 4 s
const RETIRE_MS = 3200; // when a faded-out environment is disposed
const MAX_RETIRING = 2;
const PARAM_DRIFT_EVERY = 2; // seconds between evolution's small parameter moves
const FOCUS_KEY = 'iweb:ambienceFocus';
const FOCUS_MAX_AGE = 12 * 60 * 60 * 1000; // a session older than this isn't restored
const BANDS_HZ = [[50, 160], [160, 450], [450, 1300], [1300, 3800], [3800, 11000]];
const BAND_TILT = [0, 10, 35, 60, 75];

/** Perceptual volume: the slider's 0–1 to gain. */
export const volumeGain = (v) => v * v * 0.9;

const defaultTimers = {
  setTimeout: (...a) => globalThis.setTimeout(...a),
  clearTimeout: (...a) => globalThis.clearTimeout(...a),
  setInterval: (...a) => globalThis.setInterval(...a),
  clearInterval: (...a) => globalThis.clearInterval(...a),
};

function defaultCreateContext() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) throw new Error('This browser can’t play generated sound.');
  // 'playback' lets the browser use larger buffers: steadier and lighter on the CPU. And 48 kHz
  // whatever the output device runs at: ambience gains nothing above it, and a 96 or 192 kHz
  // device would otherwise multiply every node's work (measured: 192 kHz cost ~4× the CPU).
  // The browser resamples once at the output.
  try {
    return new AC({ latencyHint: 'playback', sampleRate: 48000 });
  } catch {
    return new AC({ latencyHint: 'playback' }); // a browser that won't take a sample rate
  }
}

/** Where a focus session is kept between page loads (localStorage; tests pass their own). */
const defaultSessionStore = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(FOCUS_KEY) || 'null');
    } catch {
      return null;
    }
  },
  set(value) {
    try {
      if (value) localStorage.setItem(FOCUS_KEY, JSON.stringify(value));
      else localStorage.removeItem(FOCUS_KEY);
    } catch {
      // Storage blocked: the session just isn't restored after a reload.
    }
  },
};

/** A saved focus session, restored as paused (the page was closed, so it wasn't playing). */
function restoreFocus(saved, now) {
  if (!saved || typeof saved !== 'object') return null;
  const totalMs = Number(saved.totalMs);
  const remainingMs = Number(saved.remainingMs);
  if (!(totalMs > 0) || !(remainingMs > 1000) || remainingMs > totalMs) return null;
  if (!(now - Number(saved.savedAt) < FOCUS_MAX_AGE)) return null;
  return { status: 'paused', totalMs, remainingMs, endsAt: null, restored: true };
}

export class AmbienceEngine {
  constructor({
    createContext = defaultCreateContext,
    settingsPref = ambienceSettingsPref,
    scenesPref,
    presetsPref, // the Atmosphere 1 name
    sessionStore = typeof localStorage === 'undefined' ? null : defaultSessionStore,
    timers = defaultTimers,
    now = () => Date.now(),
    channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('iweb-ambience') : null,
    onEvent = null,
  } = {}) {
    this.createContext = createContext;
    this.settingsPref = settingsPref;
    this.scenesPref = scenesPref || presetsPref || ambienceScenesPref;
    this.presetsPref = this.scenesPref;
    this.sessionStore = sessionStore;
    this.timers = timers;
    this.now = now;
    this.onEvent = onEvent;
    this.ctx = null;
    this.graph = null;
    this.buffers = new Map(); // noise buffers, made once per context
    this.current = null; // { env, out, kit, inst, nextFrom, evolution }
    this.retiring = new Set();
    this.ticker = 0;
    this.lookahead = LOOKAHEAD;
    this.starting = null;
    this.sleepTimers = [];
    this.focusTimers = [];
    this.pendingTimers = new Set();
    this.listeners = new Set();
    this.seed = null;
    this.tabId = Math.random().toString(36).slice(2);
    this.settings = normalizeSettings(settingsPref.get()) || normalizeSettings({});
    this.runtime = {
      status: 'idle',
      error: null,
      notice: null,
      sleep: null,
      focus: restoreFocus(sessionStore?.get(), now()),
      sceneModified: false,
    };
    this.state = this.compose();

    // Another tab changed the saved settings: follow them (and never write them back here).
    this.unsubscribePref = settingsPref.subscribe?.(() => {
      const next = normalizeSettings(settingsPref.get());
      if (next && JSON.stringify(next) !== JSON.stringify(this.settings)) {
        this.settings = next;
        this.emit();
      }
    });

    this.channel = channel;
    if (channel) {
      channel.onmessage = (e) => {
        // Only one iWeb tab plays: another starting pauses this one.
        if (e.data?.type === 'play' && e.data.from !== this.tabId && this.runtime.status === 'playing') {
          this.pause();
          this.setRuntime({ notice: 'Paused: Atmosphere started in another iWeb tab.' });
        }
      };
    }

    if (typeof document !== 'undefined') {
      this.onVisibility = () => {
        this.lookahead = document.hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD;
        // Back to a suspended context while "playing": the browser stopped it. Say so.
        if (!document.hidden && this.ctx && this.ctx.state !== 'running' && this.runtime.status === 'playing') {
          this.interrupted();
        }
      };
      document.addEventListener('visibilitychange', this.onVisibility);
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      // Closing or reloading the page: keep how much of a focus session is left.
      this.onPageHide = () => this.persistFocus();
      window.addEventListener('pagehide', this.onPageHide);
    }
  }

  // ---- state ---------------------------------------------------------------------------

  compose() {
    const s = this.settings;
    const envId = s.environmentId;
    const envSettings = s.environments[envId];
    return {
      ...this.runtime,
      session: this.runtime.status === 'playing' || this.runtime.status === 'paused' || this.runtime.status === 'starting',
      environmentId: envId,
      masterVolume: s.masterVolume,
      layers: envSettings.layers,
      params: envSettings.params,
      sceneId: s.sceneId,
      evolution: s.evolution,
      spatial: s.spatial,
      glow: s.glow,
      visualizer: s.visualizer,
      sleepMinutes: s.sleepMinutes,
      focusPrefs: s.focus,
      favorites: s.favorites,
      suggest: s.suggest,
      links: s.links,
      seed: this.seed,
    };
  }

  emit() {
    this.state = this.compose();
    for (const l of [...this.listeners]) l();
  }

  setRuntime(patch) {
    this.runtime = { ...this.runtime, ...patch };
    this.emit();
  }

  saveSettings() {
    this.settingsPref.set(this.settings);
    this.emit();
  }

  getState = () => this.state;

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  later(fn, ms) {
    const id = this.timers.setTimeout(() => {
      this.pendingTimers.delete(id);
      fn();
    }, ms);
    this.pendingTimers.add(id);
    return id;
  }

  /** The user's scenes. */
  customScenes() {
    return this.scenesPref.get() || [];
  }

  // ---- the graph ------------------------------------------------------------------------

  /** Creates the AudioContext and the shared graph (once; only after a user gesture). */
  async initialize() {
    if (this.ctx) return;
    const ctx = this.createContext();
    const gain = (v) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const master = gain(0);
    const sleep = gain(1);
    const fade = gain(1); // a focus session's fade-out
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 8;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.01;
    limiter.release.value = 0.35;
    master.connect(sleep).connect(fade).connect(limiter).connect(ctx.destination);

    // One shared reverb and one shared delay for every layer that sends to them.
    const reverbIn = gain(1);
    const convolver = ctx.createConvolver();
    convolver.buffer = impulseResponse(ctx, 2, 3); // a 2 s tail: plenty for ambience, and light (measured)
    const reverbOut = gain(0.75);
    reverbIn.connect(convolver).connect(reverbOut).connect(master);

    const delayIn = gain(1);
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.42;
    const feedback = gain(0.32);
    const delayTone = ctx.createBiquadFilter();
    delayTone.type = 'lowpass';
    delayTone.frequency.value = 2600;
    const delayOut = gain(0.55);
    delayIn.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(delayTone).connect(delayOut).connect(master);

    this.graph = { master, sleep, fade, limiter, reverbIn, delayIn, analyser: null };
    this.ctx = ctx;
    ctx.onstatechange = () => {
      // Suspended or interrupted by the browser or the OS while we think we're playing.
      if (ctx.state !== 'running' && this.runtime.status === 'playing' && !this.suspending) this.interrupted();
    };
  }

  interrupted() {
    this.stopTicker();
    this.pauseFocus();
    this.setRuntime({ status: 'paused', notice: 'Paused by the browser. Press Play to continue.' });
  }

  createInstance(envId) {
    const env = environmentById(envId);
    if (!validEnvironment(env)) throw new Error(`Unknown environment: ${envId}`);
    const { ctx, graph } = this;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(graph.master);
    const kit = createKit({ ctx, out, sends: { reverb: graph.reverbIn, delay: graph.delayIn }, buffers: this.buffers, rng: seeded(this.seed ?? newSeed()) });
    try {
      const envSettings = this.settings.environments[envId];
      const inst = env.create(kit, { params: envSettings.params });
      const profile = profileOf(env);
      const mode = this.settings.evolution;
      const mults = startLevels(profile, mode);
      for (const layer of env.layers) {
        const node = inst.levels[layer.id];
        if (!node) continue;
        node.gain.value = (envSettings.layers[layer.id] ?? layer.level) * layer.scale;
        kit.configureLayer(node, layer.space);
        const rec = kit.layerOf(node);
        if (rec) rec.evo.gain.value = mults[layer.id] ?? 1;
      }
      kit.setSpace(this.settings.spatial.width, this.settings.spatial.movement, 0.05);
      if (this.seed !== null) inst.randomize(seeded(this.seed));
      const rng = seeded(((this.seed ?? newSeed()) ^ 0x5bd1e995) >>> 0);
      const evolution = {
        profile,
        rng,
        mults,
        offsets: { mood: 0, variation: 0, depth: 0 },
        offsetTarget: { mood: 0, variation: 0, depth: 0 },
        tc: 20,
        nextAt: ctx.currentTime + firstWait(mode, rng),
        lastDrift: ctx.currentTime,
        steps: 0,
      };
      return { env, out, kit, inst, nextFrom: 0, evolution };
    } catch (err) {
      kit.dispose();
      out.disconnect();
      throw err;
    }
  }

  /** Fades an environment out and disposes it shortly after. */
  retire(instance) {
    if (!instance) return;
    glide(instance.out.gain, 0, this.ctx, 0.5);
    this.retiring.add(instance);
    instance.retireTimer = this.later(() => this.disposeInstance(instance), RETIRE_MS);
    // Switching fast: never more than a couple fading at once.
    while (this.retiring.size > MAX_RETIRING) {
      const oldest = this.retiring.values().next().value;
      this.disposeInstance(oldest);
    }
  }

  disposeInstance(instance) {
    if (!instance) return;
    if (instance.retireTimer) {
      this.timers.clearTimeout(instance.retireTimer);
      this.pendingTimers.delete(instance.retireTimer);
    }
    instance.kit.dispose();
    try { instance.out.disconnect(); } catch { /* already */ }
    this.retiring.delete(instance);
    if (this.current === instance) this.current = null;
  }

  // ---- scheduling -----------------------------------------------------------------------

  tick = () => {
    const cur = this.current;
    if (!cur || this.runtime.status !== 'playing' || !this.ctx) return;
    const now = this.ctx.currentTime;
    const from = Math.max(cur.nextFrom, now + 0.05);
    const to = now + this.lookahead;
    if (to > from) {
      try {
        cur.inst.schedule(from, to);
      } catch (err) {
        console.warn('[ambience] scheduling failed', err?.message);
      }
      cur.nextFrom = to;
    }
    this.evolve(cur, now);
  };

  startTicker() {
    if (this.ticker) return;
    this.tick();
    this.ticker = this.timers.setInterval(this.tick, TICK_MS);
  }

  stopTicker() {
    if (!this.ticker) return;
    this.timers.clearInterval(this.ticker);
    this.ticker = 0;
  }

  // ---- Living Atmosphere ----------------------------------------------------------------

  /** The parameters the instance plays with: the user's, plus evolution's small drift. */
  effective(envId = this.settings.environmentId) {
    const params = this.settings.environments[envId].params;
    const evo = this.current?.env.id === envId ? this.current.evolution : null;
    return this.settings.evolution === 'off' || !evo ? params : effectiveParams(params, evo.offsets);
  }

  /** One evolution step when it's due, and the parameters' slow drift towards their targets. */
  evolve(cur, now) {
    const mode = this.settings.evolution;
    const evo = cur.evolution;
    if (mode === 'off' || !evo) return;
    try {
      if (now >= evo.nextAt) {
        const envSettings = this.settings.environments[cur.env.id];
        const levels = Object.fromEntries(cur.env.layers.map((l) => [l.id, (envSettings.layers[l.id] ?? l.level) * l.scale]));
        const step = evolutionStep({ profile: evo.profile, mode, rng: evo.rng, current: evo.mults, levels });
        for (const layer of cur.env.layers) {
          const rec = cur.kit.layerOf(cur.inst.levels[layer.id]);
          if (rec && step.targets[layer.id] !== undefined) glide(rec.evo.gain, step.targets[layer.id], this.ctx, step.tc);
        }
        evo.mults = step.targets;
        evo.offsetTarget = step.offsets;
        evo.tc = step.tc;
        if (step.harmonic) cur.inst.evolve?.(evo.rng);
        evo.nextAt = now + step.wait;
        evo.steps += 1;
      }
      // Mood, Variation and Depth drift in small moves every couple of seconds.
      const dt = now - evo.lastDrift;
      if (dt >= PARAM_DRIFT_EVERY) {
        evo.lastDrift = now;
        const k = 1 - Math.exp(-dt / Math.max(1, evo.tc));
        let moved = false;
        for (const p of PARAMS) {
          const d = evo.offsetTarget[p] - evo.offsets[p];
          if (Math.abs(d) > 0.002) {
            evo.offsets[p] += d * k;
            moved = true;
          }
        }
        if (moved) cur.inst.apply(this.effective(cur.env.id));
      }
    } catch (err) {
      console.warn('[ambience] evolution step failed', err?.message);
      evo.nextAt = now + 60;
    }
  }

  /** Evolution: 'off' | 'gentle' | 'dynamic' | 'organic'. */
  setEvolution(mode) {
    if (!EVOLUTION_MODES.includes(mode) || mode === this.settings.evolution) return;
    this.settings = { ...this.settings, evolution: mode };
    this.runtime = { ...this.runtime, sceneModified: Boolean(this.settings.sceneId) };
    const cur = this.current;
    if (cur && this.ctx) {
      const evo = cur.evolution;
      const now = this.ctx.currentTime;
      if (mode === 'off') {
        // Back to the mix as set, slowly.
        for (const layer of cur.env.layers) {
          const rec = cur.kit.layerOf(cur.inst.levels[layer.id]);
          if (rec) glide(rec.evo.gain, 1, this.ctx, 3);
        }
        evo.mults = Object.fromEntries(cur.env.layers.map((l) => [l.id, 1]));
        evo.offsets = { mood: 0, variation: 0, depth: 0 };
        evo.offsetTarget = { mood: 0, variation: 0, depth: 0 };
        cur.inst.apply(this.effective(cur.env.id));
      } else {
        evo.nextAt = Math.min(evo.nextAt, now + firstWait(mode, evo.rng));
      }
    }
    this.saveSettings();
  }

  // ---- stereo ---------------------------------------------------------------------------

  /** Width and Movement (0–1). */
  setSpatial(patch) {
    const clamp = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
    const spatial = {
      width: clamp(patch?.width, this.settings.spatial.width),
      movement: clamp(patch?.movement, this.settings.spatial.movement),
    };
    this.settings = { ...this.settings, spatial };
    this.runtime = { ...this.runtime, sceneModified: Boolean(this.settings.sceneId) };
    this.current?.kit.setSpace(spatial.width, spatial.movement, 0.8);
    this.saveSettings();
  }

  // ---- playback -------------------------------------------------------------------------

  /** Starts (or resumes) playing; `envId` switches first. Needs a user gesture the first time. */
  play(envId) {
    if (envId && envId !== this.settings.environmentId) this.changeEnvironment(envId);
    if (this.starting) return this.starting;
    if (this.runtime.status === 'playing') return Promise.resolve();
    this.starting = (async () => {
      this.setRuntime({ status: 'starting', error: null, notice: null });
      try {
        await this.initialize();
        const { ctx, graph } = this;
        try {
          await ctx.resume();
        } catch {
          // handled below: the state says whether it's running
        }
        if (ctx.state !== 'running') throw Object.assign(new Error('blocked'), { code: 'BLOCKED' });
        if (!this.current || this.current.env.id !== this.settings.environmentId) {
          if (this.current) this.retire(this.current);
          this.current = this.createInstance(this.settings.environmentId);
        }
        this.current.nextFrom = ctx.currentTime + 0.05;
        glide(this.current.out.gain, 1, ctx, 0.5);
        glide(graph.master.gain, volumeGain(this.settings.masterVolume), ctx, 0.35);
        this.suspending = false;
        this.setRuntime({ status: 'playing' });
        this.startTicker();
        this.resumeFocus();
        this.channel?.postMessage({ type: 'play', from: this.tabId });
      } catch (err) {
        this.stopTicker();
        const message = err?.code === 'BLOCKED'
          ? 'The browser didn’t allow sound to start. Press Play again.'
          : err?.message?.startsWith('This browser') ? err.message : 'Atmosphere couldn’t start.';
        if (!err?.code) console.warn('[ambience] start failed:', err?.message);
        this.setRuntime({ status: 'error', error: message });
      } finally {
        this.starting = null;
      }
    })();
    return this.starting;
  }

  pause() {
    if (this.runtime.status !== 'playing' || !this.ctx) return;
    this.stopTicker();
    this.pauseFocus();
    glide(this.graph.master.gain, 0, this.ctx, 0.12);
    this.suspending = true;
    this.setRuntime({ status: 'paused', notice: null });
    // Once faded, let the browser stop the audio thread.
    this.later(() => {
      if (this.runtime.status === 'paused' && this.ctx) this.ctx.suspend().catch(() => {});
    }, 600);
  }

  resume() {
    return this.play();
  }

  toggle() {
    return this.runtime.status === 'playing' || this.runtime.status === 'starting' ? this.pause() : this.play();
  }

  stop() {
    if (this.runtime.status === 'idle') return;
    this.stopTicker();
    this.clearSleep();
    this.clearFocus();
    if (this.ctx) glide(this.graph.master.gain, 0, this.ctx, 0.2);
    this.suspending = true;
    this.setRuntime({ status: 'idle', notice: null, error: null, sleep: null, focus: null });
    this.later(() => {
      if (this.runtime.status !== 'idle') return; // played again meanwhile
      for (const inst of [...this.retiring]) this.disposeInstance(inst);
      this.disposeInstance(this.current);
      this.ctx?.suspend().catch(() => {});
    }, 900);
  }

  changeEnvironment(envId, { keepScene = false } = {}) {
    if (!environmentById(envId) || envId === this.settings.environmentId) return;
    this.settings = { ...this.settings, environmentId: envId, sceneId: keepScene ? this.settings.sceneId : null };
    if (!keepScene) this.runtime = { ...this.runtime, sceneModified: false };
    if (this.current && this.ctx) {
      if (this.runtime.status === 'playing') {
        // Crossfade: the new one comes up while the old one fades and is then disposed.
        const old = this.current;
        try {
          this.current = this.createInstance(envId);
          this.current.nextFrom = this.ctx.currentTime + 0.05;
          glide(this.current.out.gain, 1, this.ctx, ENV_FADE_TC);
        } catch (err) {
          console.warn('[ambience] environment failed:', err?.message);
          this.current = null;
          this.setRuntime({ notice: 'That environment couldn’t start.' });
        }
        this.retire(old);
      } else {
        this.disposeInstance(this.current); // made fresh on Play
      }
    }
    this.saveSettings();
  }

  nextEnvironment() {
    this.changeEnvironment(nextEnvironmentId(this.settings.environmentId));
  }

  setMasterVolume(value) {
    const v = Math.min(1, Math.max(0, Number(value) || 0));
    this.settings = { ...this.settings, masterVolume: v };
    if (this.ctx && this.runtime.status === 'playing') glide(this.graph.master.gain, volumeGain(v), this.ctx, 0.12);
    this.saveSettings();
  }

  updateEnv(envId, patch) {
    const envs = this.settings.environments;
    this.settings = { ...this.settings, environments: { ...envs, [envId]: { ...envs[envId], ...patch } } };
  }

  setLayerVolume(layerId, value) {
    const envId = this.settings.environmentId;
    const env = environmentById(envId);
    const layer = env.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const v = Math.min(1, Math.max(0, Number(value) || 0));
    this.updateEnv(envId, { layers: { ...this.settings.environments[envId].layers, [layerId]: v } });
    this.runtime = { ...this.runtime, sceneModified: Boolean(this.settings.sceneId) };
    const node = this.current?.env.id === envId ? this.current.inst.levels[layerId] : null;
    if (node && this.ctx) glide(node.gain, v * layer.scale, this.ctx, 0.2);
    this.saveSettings();
  }

  setParameter(name, value) {
    if (!PARAMS.includes(name)) return;
    const envId = this.settings.environmentId;
    const params = { ...this.settings.environments[envId].params, [name]: Math.min(1, Math.max(0, Number(value) || 0)) };
    this.updateEnv(envId, { params });
    this.runtime = { ...this.runtime, sceneModified: Boolean(this.settings.sceneId) };
    if (this.current?.env.id === envId) this.current.inst.apply(this.effective(envId));
    this.saveSettings();
  }

  /** A new arrangement in the same environment: no restart, no volume change. */
  randomize() {
    this.seed = newSeed();
    const cur = this.current;
    if (cur && this.ctx) {
      cur.inst.randomize(seeded(this.seed));
      // Evolution carries on from here with a fresh sequence, and not at the same moment.
      cur.evolution.rng = seeded((this.seed ^ 0x5bd1e995) >>> 0);
      cur.evolution.nextAt = Math.max(cur.evolution.nextAt, this.ctx.currentTime + 20);
    }
    this.emit();
  }

  // ---- scenes ---------------------------------------------------------------------------

  /**
   * Applies a scene (an id, or a scene / old preset object): its environment, layers,
   * character, evolution and stereo image. Same environment: everything glides there; another
   * one: a crossfade. The master volume and the AudioContext are left as they are.
   * `play` starts playback too (it must come from a user gesture).
   */
  applyScene(sceneOrId, { play = false } = {}) {
    const scene = typeof sceneOrId === 'string'
      ? findScene(sceneOrId, this.customScenes())
      : normalizeScene(sceneOrId, { builtIn: Boolean(sceneOrId?.builtIn) });
    if (!scene) return Promise.resolve(false);
    const envId = scene.environmentId;
    const { mood, variation, depth, evolutionMode, spatialWidth, movement } = scene.parameters;
    this.updateEnv(envId, { layers: scene.layers, params: { mood, variation, depth } });
    const evolutionChanged = evolutionMode !== this.settings.evolution;
    this.settings = {
      ...this.settings,
      sceneId: scene.id,
      evolution: evolutionMode,
      spatial: { width: spatialWidth, movement },
    };
    this.runtime = { ...this.runtime, sceneModified: false };
    if (scene.seed !== null) this.seed = scene.seed;

    if (envId !== this.settings.environmentId) {
      this.changeEnvironment(envId, { keepScene: true });
    } else if (this.current && this.ctx) {
      const cur = this.current;
      for (const layer of cur.env.layers) {
        const node = cur.inst.levels[layer.id];
        if (node) glide(node.gain, scene.layers[layer.id] * layer.scale, this.ctx, SCENE_TC);
      }
      if (scene.seed !== null) cur.inst.randomize(seeded(scene.seed));
      cur.kit.setSpace(spatialWidth, movement, SCENE_TC);
      if (evolutionChanged) {
        const evo = cur.evolution;
        if (evolutionMode === 'off') {
          for (const layer of cur.env.layers) {
            const rec = cur.kit.layerOf(cur.inst.levels[layer.id]);
            if (rec) glide(rec.evo.gain, 1, this.ctx, 3);
          }
          evo.mults = Object.fromEntries(cur.env.layers.map((l) => [l.id, 1]));
          evo.offsets = { mood: 0, variation: 0, depth: 0 };
          evo.offsetTarget = { mood: 0, variation: 0, depth: 0 };
        } else {
          evo.nextAt = Math.min(evo.nextAt, this.ctx.currentTime + firstWait(evolutionMode, evo.rng));
        }
      }
      cur.inst.apply(this.effective(envId));
      this.saveSettings();
    } else {
      this.disposeInstance(this.current); // made fresh, with the scene, on Play
      this.saveSettings();
    }
    return play ? this.play().then(() => true) : Promise.resolve(true);
  }

  /** Saves the current sound as one of the user's scenes (a name already used is replaced). */
  saveScene(name) {
    const s = this.settings;
    const envId = s.environmentId;
    const scene = normalizeScene({
      name,
      environmentId: envId,
      parameters: {
        ...s.environments[envId].params,
        evolutionMode: s.evolution,
        spatialWidth: s.spatial.width,
        movement: s.spatial.movement,
      },
      layers: s.environments[envId].layers,
      seed: this.seed,
    });
    if (!scene) return null;
    const rest = this.customScenes().filter((p) => p.name.toLowerCase() !== scene.name.toLowerCase());
    this.scenesPref.set([...rest, scene]);
    this.settings = { ...s, sceneId: scene.id };
    this.runtime = { ...this.runtime, sceneModified: false };
    this.saveSettings();
    return scene;
  }

  renameScene(id, name) {
    const clean = typeof name === 'string' ? name.trim().slice(0, 40) : '';
    if (!clean) return false;
    const list = this.customScenes();
    if (!list.some((s) => s.id === id)) return false;
    this.scenesPref.set(list.map((s) => (s.id === id ? { ...s, name: clean } : s)));
    this.emit();
    return true;
  }

  deleteScene(id) {
    this.scenesPref.set(this.customScenes().filter((s) => s.id !== id));
    const s = this.settings;
    if (s.favorites.includes(id) || s.sceneId === id) {
      this.settings = { ...s, favorites: s.favorites.filter((f) => f !== id), sceneId: s.sceneId === id ? null : s.sceneId };
      this.saveSettings();
    } else {
      this.emit();
    }
  }

  toggleFavorite(id) {
    const favs = this.settings.favorites;
    this.settings = { ...this.settings, favorites: favs.includes(id) ? favs.filter((f) => f !== id) : [...favs, id].slice(-24) };
    this.saveSettings();
  }

  // The Atmosphere 1 preset API, kept for anything still calling it.
  savePreset(name) { return this.saveScene(name); }
  deletePreset(id) { this.deleteScene(id); }
  applyPreset(raw) { return this.applyScene(raw); }

  // ---- options --------------------------------------------------------------------------

  setGlow(patch) {
    this.settings = { ...this.settings, glow: { ...this.settings.glow, ...patch } };
    this.saveSettings();
  }

  setVisualizer(on) {
    this.settings = { ...this.settings, visualizer: Boolean(on) };
    this.saveSettings();
  }

  /** { wallpaper?, time? }: the suggestion switches. */
  setSuggest(patch) {
    this.settings = { ...this.settings, suggest: { ...this.settings.suggest, ...patch } };
    this.saveSettings();
  }

  /** Links a wallpaper ('local:12', 'unsplash:abc') to a scene, or unlinks it (null). */
  linkWallpaper(key, sceneId) {
    const links = { ...this.settings.links };
    if (sceneId) links[key] = sceneId;
    else delete links[key];
    this.settings = normalizeSettings({ ...this.settings, links }) || this.settings;
    this.saveSettings();
  }

  // ---- sleep timer ----------------------------------------------------------------------

  clearSleep() {
    this.sleepTimers.forEach((t) => this.timers.clearTimeout(t));
    this.sleepTimers = [];
  }

  /** Fades out and stops after `minutes` (15, 30, 60, 120), or cancels with null. */
  setSleepTimer(minutes) {
    this.clearSleep();
    if (this.ctx) glide(this.graph.sleep.gain, 1, this.ctx, 0.5); // a cancelled fade comes back
    if (!SLEEP_OPTIONS.includes(minutes)) {
      this.settings = { ...this.settings, sleepMinutes: null };
      this.runtime = { ...this.runtime, sleep: null };
      this.saveSettings();
      return;
    }
    const total = minutes * 60;
    const fade = Math.min(60, total * 0.25);
    const endsAt = this.now() + total * 1000;
    this.sleepTimers.push(this.timers.setTimeout(() => {
      if (!this.ctx) return;
      const p = this.graph.sleep.gain;
      const t = this.ctx.currentTime;
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(0.0001, t + fade);
    }, (total - fade) * 1000));
    this.sleepTimers.push(this.timers.setTimeout(() => {
      this.stop();
      this.later(() => {
        if (this.ctx) this.graph.sleep.gain.setValueAtTime(1, this.ctx.currentTime);
      }, 1000);
    }, total * 1000));
    this.settings = { ...this.settings, sleepMinutes: minutes };
    this.runtime = { ...this.runtime, sleep: { minutes, endsAt } };
    this.saveSettings();
  }

  // ---- focus sessions -------------------------------------------------------------------
  //
  // A session runs while Atmosphere plays: pausing pauses it (and its clock), Play resumes it.
  // Near the end the sound fades out (the last minute, or the last quarter of a short session)
  // and then stops or pauses, as chosen. A reload restores it as paused, with what was left.

  /** The time left in the session, in ms. */
  focusRemaining(focus = this.runtime.focus) {
    if (!focus) return 0;
    return focus.status === 'running' ? Math.max(0, focus.endsAt - this.now()) : focus.remainingMs;
  }

  persistFocus() {
    const f = this.runtime.focus;
    this.sessionStore?.set(f ? { v: 1, totalMs: f.totalMs, remainingMs: this.focusRemaining(f), savedAt: this.now() } : null);
  }

  clearFocusTimers() {
    this.focusTimers.forEach((t) => this.timers.clearTimeout(t));
    this.focusTimers = [];
  }

  /** Back to full level after a fade (a cancelled, paused or extended session). */
  restoreFade(tc = 0.5) {
    if (this.ctx && this.graph) glide(this.graph.fade.gain, 1, this.ctx, tc);
  }

  armFocus() {
    this.clearFocusTimers();
    const f = this.runtime.focus;
    if (!f || f.status !== 'running') return;
    const left = Math.max(0, f.endsAt - this.now());
    const fadeMs = Math.min(60000, f.totalMs * 0.25);
    const fadeNow = () => {
      if (!this.ctx) return;
      const p = this.graph.fade.gain;
      const t = this.ctx.currentTime;
      const span = Math.max(0.5, Math.min(fadeMs, Math.max(0, this.runtime.focus?.endsAt - this.now())) / 1000);
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(0.0001, t + span);
    };
    if (left <= fadeMs) fadeNow();
    else this.focusTimers.push(this.timers.setTimeout(fadeNow, left - fadeMs));
    this.focusTimers.push(this.timers.setTimeout(() => this.completeFocus(), left));
  }

  /** Starts a focus session of `minutes` (and playback: call it from a user gesture). */
  startFocus(minutes) {
    const m = validFocusMinutes(minutes);
    if (!m) return Promise.resolve(false);
    this.clearFocusTimers();
    this.restoreFade(0.3);
    const totalMs = m * 60000;
    this.runtime = {
      ...this.runtime,
      focus: { status: this.runtime.status === 'playing' ? 'running' : 'paused', totalMs, remainingMs: totalMs, endsAt: this.now() + totalMs, restored: false },
    };
    this.settings = { ...this.settings, focus: { ...this.settings.focus, minutes: m } };
    if (this.runtime.focus.status === 'running') this.armFocus();
    this.persistFocus();
    this.saveSettings();
    return this.play().then(() => this.runtime.status === 'playing');
  }

  pauseFocus() {
    const f = this.runtime.focus;
    if (!f || f.status !== 'running') return;
    this.clearFocusTimers();
    this.restoreFade(0.2); // the master is fading anyway
    this.runtime = { ...this.runtime, focus: { ...f, status: 'paused', remainingMs: this.focusRemaining(f), endsAt: null } };
    this.persistFocus();
  }

  resumeFocus() {
    const f = this.runtime.focus;
    if (!f || f.status !== 'paused') return;
    this.runtime = { ...this.runtime, focus: { ...f, status: 'running', endsAt: this.now() + f.remainingMs, restored: false } };
    this.armFocus();
    this.persistFocus();
    this.emit();
  }

  /** Adds `minutes` to the session (and lifts a fade already under way). */
  extendFocus(minutes = 10) {
    const f = this.runtime.focus;
    const add = Math.max(1, Math.min(120, Number(minutes) || 0)) * 60000;
    if (!f) return;
    this.restoreFade(0.8);
    this.runtime = {
      ...this.runtime,
      focus: { ...f, totalMs: f.totalMs + add, remainingMs: f.remainingMs + add, endsAt: f.endsAt === null ? null : f.endsAt + add },
    };
    this.armFocus();
    this.persistFocus();
    this.emit();
  }

  clearFocus() {
    this.clearFocusTimers();
    this.runtime = { ...this.runtime, focus: null };
    this.sessionStore?.set(null);
  }

  /** Ends the session without stopping the sound. */
  cancelFocus() {
    if (!this.runtime.focus) return;
    this.clearFocus();
    this.restoreFade(0.8);
    this.emit();
  }

  /** What the session does when it ends: 'stop' or 'pause'. */
  setFocusEnd(end) {
    this.settings = { ...this.settings, focus: { ...this.settings.focus, end: end === 'pause' ? 'pause' : 'stop' } };
    this.saveSettings();
  }

  completeFocus() {
    const f = this.runtime.focus;
    if (!f) return;
    this.clearFocus();
    this.emit();
    this.onEvent?.({ type: 'focus-complete', minutes: Math.round(f.totalMs / 60000), sceneId: this.settings.sceneId, environmentId: this.settings.environmentId });
    if (this.settings.focus.end === 'pause') this.pause();
    else this.stop();
    // The fade gain comes back once the sound is down.
    this.later(() => {
      if (this.ctx) this.graph.fade.gain.setValueAtTime(1, this.ctx.currentTime);
    }, 1000);
  }

  // ---- the meter (edge glow, island level bars) -----------------------------------------

  ensureAnalyser() {
    let a = this.graph.analyser;
    if (!a) {
      a = this.ctx.createAnalyser();
      a.fftSize = 512;
      a.smoothingTimeConstant = 0.55;
      this.graph.fade.connect(a); // a dead end: it measures, it doesn't play
      this.graph.analyser = a;
      this.meterTime = new Uint8Array(a.fftSize);
      this.meterFreq = new Uint8Array(a.frequencyBinCount);
    }
    return a;
  }

  /** Overall loudness 0–1 (smoothed by the caller), or null when nothing's playing. */
  energy() {
    if (!this.ctx || this.runtime.status !== 'playing') return null;
    const a = this.ensureAnalyser();
    a.getByteTimeDomainData(this.meterTime);
    let sum = 0;
    for (let i = 0; i < this.meterTime.length; i += 1) {
      const v = (this.meterTime[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / this.meterTime.length) * 4);
  }

  /**
   * The sound right now: { energy, bands } (bands: five 0–1 levels from low to high), read
   * from the real output. Null when nothing's playing.
   */
  meter() {
    const energy = this.energy();
    if (energy === null) return null;
    const a = this.graph.analyser;
    a.getByteFrequencyData(this.meterFreq);
    const hzPerBin = this.ctx.sampleRate / a.fftSize;
    const bands = BANDS_HZ.map(([lo, hi], band) => {
      const from = Math.max(1, Math.floor(lo / hzPerBin));
      const to = Math.min(this.meterFreq.length - 1, Math.max(from, Math.ceil(hi / hzPerBin)));
      let sum = 0;
      for (let i = from; i <= to; i += 1) sum += this.meterFreq[i];
      const mean = sum / (to - from + 1);
      // Bytes are −100…−30 dB (≈0.27 dB each). Ambience falls off towards the highs, so each
      // band is lifted by a fixed tilt (measured across the six environments) to give every
      // bar room to move.
      return Math.min(1, Math.max(0, (mean + BAND_TILT[band] - 80) / 140));
    });
    return { energy, bands };
  }

  /** Stops measuring (the analyser costs nothing once it's out of the graph). */
  releaseMeter() {
    const a = this.graph?.analyser;
    if (!a) return;
    try { this.graph.fade.disconnect(a); } catch { /* already */ }
    this.graph.analyser = null;
  }

  // ---- teardown -------------------------------------------------------------------------

  /** For tests and diagnostics: what's alive. */
  diagnostics() {
    const evo = this.current?.evolution;
    return {
      context: this.ctx ? this.ctx.state : 'none',
      instances: (this.current ? 1 : 0) + this.retiring.size,
      nodes: [this.current, ...this.retiring].filter(Boolean).reduce((n, i) => n + i.kit.counts().owned, 0),
      voices: [this.current, ...this.retiring].filter(Boolean).reduce((n, i) => n + i.kit.counts().active, 0),
      ticking: Boolean(this.ticker),
      buffers: this.buffers.size,
      evolution: evo ? { mode: this.settings.evolution, steps: evo.steps, nextAt: evo.nextAt, mults: { ...evo.mults }, offsets: { ...evo.offsets } } : null,
      focusTimers: this.focusTimers.length,
    };
  }

  dispose() {
    this.stopTicker();
    this.clearSleep();
    this.clearFocusTimers();
    this.pendingTimers.forEach((t) => this.timers.clearTimeout(t));
    this.pendingTimers.clear();
    for (const inst of [...this.retiring]) this.disposeInstance(inst);
    this.disposeInstance(this.current);
    this.unsubscribePref?.();
    if (this.onVisibility) document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.onPageHide) window.removeEventListener('pagehide', this.onPageHide);
    this.channel?.close?.();
    this.ctx?.close?.().catch?.(() => {});
    this.ctx = null;
    this.graph = null;
    this.buffers.clear();
    this.listeners.clear();
  }
}
