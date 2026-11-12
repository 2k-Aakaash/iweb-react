import { useEffect, useId, useRef, useState } from 'react';
import GlassSurface from '../glass/GlassSurface';
import MacSlider from '../ui/MacSlider';
import AtmosphereGlyph from './AtmosphereGlyph';
import LevelBars from './LevelBars';
import FocusTime from './FocusTime';
import { useMacWindow } from '../../libs/window/useMacWindow';
import { ENVIRONMENTS, environmentById } from '../../libs/ambience/environments/index.js';
import { EVOLUTION_LABELS, EVOLUTION_MODES } from '../../libs/ambience/evolution.js';
import { FOCUS_OPTIONS, SLEEP_OPTIONS } from '../../libs/ambience/prefs.js';
import { BUILT_IN_SCENES } from '../../libs/ambience/scenes.js';
import { TIME_SLOTS, sceneForTime, timeSlot, wallpaperKey } from '../../libs/ambience/suggestions.js';
import { currentScene, getAmbience, useAmbience, useAmbienceScenes } from '../../libs/ambience/store.js';
import { useTicker } from '../../libs/controlcenter/timer';
import { getActiveWallpaper } from '../../libs/wallpaper/settings.js';
import { subscribe as subscribeWallpaper } from '../../libs/wallpaper/sync.js';
import { getWallpaperRecord } from '../../libs/wallpaper/repository.js';
import '../../styles/atmosphere.css';

// Atmosphere: the main control surface for the ambience engine (libs/ambience), as an iWeb
// window (useMacWindow: genie into its Dock icon, move, resize, snap). The island is the quick
// control and the edge glow the decoration; this is where everything is chosen, in three
// parts:
//   Explore     scenes (favourites first, then the built-in ones and yours) and environments
//   Customize   the mix, character, evolution and stereo image; save as a scene
//   Experience  focus sessions, the sleep timer, visual effects and suggestions
// Every control calls the engine; the engine's state is what's shown.

const TABS = [
  { id: 'explore', label: 'Explore' },
  { id: 'customize', label: 'Customize' },
  { id: 'experience', label: 'Experience' },
];
const TAB_KEY = 'iweb:atmosphereTab';

const CHARACTER = [
  { id: 'mood', label: 'Mood', low: 'Calm', high: 'Energetic' },
  { id: 'variation', label: 'Variation', low: 'Stable', high: 'Evolving' },
  { id: 'depth', label: 'Depth', low: 'Light', high: 'Deep' },
];

const SPACE = [
  { id: 'width', label: 'Width', low: 'Narrow', high: 'Wide' },
  { id: 'movement', label: 'Movement', low: 'Still', high: 'Drifting' },
];

const Icon = {
  play: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>,
  pause: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /></svg>,
  stop: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" /></svg>,
  shuffle: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>,
  low: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" /></svg>,
  high: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" stroke="none" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></svg>,
  star: (on) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>,
};

const readTab = () => {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS.some((x) => x.id === t) ? t : 'explore';
  } catch {
    return 'explore';
  }
};

function statusLine(state, env, scene) {
  if (state.status === 'error') return state.error;
  if (state.notice) return state.notice;
  if (state.status === 'starting') return 'Starting…';
  const what = scene ? `${scene.name}${state.sceneModified ? ' (edited)' : ''} · ${env.name}` : env.name;
  if (state.status === 'playing') return `${what} · generated live`;
  if (state.status === 'paused') return `${what} · paused`;
  return 'Generated live in your browser. Nothing is downloaded.';
}

// ---- small parts -----------------------------------------------------------------------

function Segmented({ label, options, value, onChange, small = false }) {
  return (
    <div className={`atm-seg${small ? ' is-small' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={on} className={`atm-seg-btn${on ? ' is-on' : ''}`} onClick={() => onChange(o.value)} title={o.title}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function RangeRow({ label, low, high, value, onChange }) {
  return (
    <div className="atm-slider-row is-character">
      <span className="atm-slider-label">{label}</span>
      <span className="atm-end">{low}</span>
      <MacSlider aria-label={`${label}: ${low} to ${high}`} aria-valuetext={`${Math.round(value * 100)}%`} min={0} max={100} value={Math.round(value * 100)} onChange={(v) => onChange(v / 100)} />
      <span className="atm-end">{high}</span>
    </div>
  );
}

function Switch({ label, checked, onChange, disabled = false, hint }) {
  return (
    <div className="atm-row">
      <span className="atm-row-label">{label}</span>
      <input type="checkbox" className="settings-switch" aria-label={label} disabled={disabled} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {hint && <span className="atm-hint">{hint}</span>}
    </div>
  );
}

function SceneCard({ scene, state, favorite }) {
  const engine = getAmbience();
  const env = environmentById(scene.environmentId);
  const active = state.sceneId === scene.id && state.environmentId === scene.environmentId;
  const playing = active && state.status === 'playing';
  return (
    <div className={`atm-scene${active ? ' is-active' : ''}`} style={{ '--env-a': env.palette[0], '--env-b': env.palette[1], '--env-accent': env.accent }}>
      <button
        type="button"
        className="atm-scene-main"
        aria-pressed={active}
        // The playing scene pauses; another (or this one, paused) applies and plays.
        onClick={() => (playing ? engine.pause() : engine.applyScene(scene, { play: true }))}
        title={playing ? 'Pause' : `Play ${scene.name}`}
      >
        <span className="atm-scene-swatch" aria-hidden="true">{playing ? Icon.pause : Icon.play}</span>
        <span className="atm-scene-text">
          <span className="atm-scene-name">{scene.name}</span>
          <span className="atm-scene-desc">{scene.description || `${env.name} · your scene`}</span>
        </span>
      </button>
      <button
        type="button"
        className={`atm-star${favorite ? ' is-on' : ''}`}
        aria-pressed={favorite}
        aria-label={favorite ? `Remove ${scene.name} from Favorites` : `Add ${scene.name} to Favorites`}
        title={favorite ? 'Remove from Favorites' : 'Add to Favorites'}
        onClick={() => engine.toggleFavorite(scene.id)}
      >
        {Icon.star(favorite)}
      </button>
    </div>
  );
}

function CustomScene({ scene, state }) {
  const engine = getAmbience();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(scene.name);
  const env = environmentById(scene.environmentId);
  const active = state.sceneId === scene.id;
  if (editing) {
    return (
      <li className="atm-preset">
        <form
          className="atm-preset-save"
          onSubmit={(e) => {
            e.preventDefault();
            if (engine.renameScene(scene.id, name)) setEditing(false);
          }}
        >
          <input
            className="atm-input"
            aria-label={`New name for ${scene.name}`}
            value={name}
            maxLength={40}

            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setName(scene.name);
                setEditing(false);
              }
            }}
          />
          <button type="submit" className="atm-btn" disabled={!name.trim()}>Rename</button>
        </form>
      </li>
    );
  }
  return (
    <li className={`atm-preset${active ? ' is-active' : ''}`}>
      <button type="button" className="atm-preset-apply" onClick={() => engine.applyScene(scene, { play: true })} title={`Play ${scene.name}`}>
        <span className="atm-preset-name">{scene.name}</span>
        <span className="atm-preset-env">{env?.name}</span>
      </button>
      <button type="button" className={`atm-icon-btn atm-star-sm${state.favorites.includes(scene.id) ? ' is-on' : ''}`} aria-label={`Favorite ${scene.name}`} aria-pressed={state.favorites.includes(scene.id)} title="Favorite" onClick={() => engine.toggleFavorite(scene.id)}>
        {Icon.star(state.favorites.includes(scene.id))}
      </button>
      <button type="button" className="atm-text-btn" onClick={() => { setName(scene.name); setEditing(true); }}>Rename</button>
      <button type="button" className="atm-icon-btn" aria-label={`Delete ${scene.name}`} title="Delete" onClick={() => engine.deleteScene(scene.id)}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
    </li>
  );
}

// ---- Explore ---------------------------------------------------------------------------

function Explore({ state, playing, ids }) {
  const engine = getAmbience();
  const custom = useAmbienceScenes();
  const all = [...BUILT_IN_SCENES, ...custom];
  const favorites = state.favorites.map((id) => all.find((s) => s.id === id)).filter(Boolean);
  // The time-of-day suggestion (when it's on): computed when shown, no timer.
  const now = new Date();
  const suggested = state.suggest.time ? sceneForTime(now) : null;
  const slot = TIME_SLOTS[timeSlot(now)];

  return (
    <>
      {suggested && state.sceneId !== suggested.id && (
        <section className="atm-suggest" aria-label="Suggestion">
          <span className="atm-suggest-text">Suggested for {slot.label}: <strong>{suggested.name}</strong></span>
          <button type="button" className="atm-btn" onClick={() => engine.applyScene(suggested.id, { play: true })}>Play</button>
        </section>
      )}

      {favorites.length > 0 && (
        <section className="atm-section" aria-labelledby={`${ids}-fav`}>
          <h3 id={`${ids}-fav`}>Favorites</h3>
          <div className="atm-scenes">
            {favorites.map((s) => <SceneCard key={s.id} scene={s} state={state} favorite />)}
          </div>
        </section>
      )}

      <section className="atm-section" aria-labelledby={`${ids}-scenes`}>
        <h3 id={`${ids}-scenes`}>Scenes</h3>
        <div className="atm-scenes">
          {BUILT_IN_SCENES.map((s) => <SceneCard key={s.id} scene={s} state={state} favorite={state.favorites.includes(s.id)} />)}
        </div>
      </section>

      {custom.length > 0 && (
        <section className="atm-section" aria-labelledby={`${ids}-yours`}>
          <h3 id={`${ids}-yours`}>Your Scenes</h3>
          <ul className="atm-preset-list">
            {custom.map((s) => <CustomScene key={s.id} scene={s} state={state} />)}
          </ul>
        </section>
      )}

      <section className="atm-section" aria-labelledby={`${ids}-envs`}>
        <h3 id={`${ids}-envs`}>Environments</h3>
        <div className="atm-envs">
          {ENVIRONMENTS.map((e) => {
            const selected = e.id === state.environmentId;
            return (
              <button
                key={e.id}
                type="button"
                aria-pressed={selected}
                className={`atm-env${selected ? ' is-selected' : ''}`}
                style={{ '--env-a': e.palette[0], '--env-b': e.palette[1], '--env-accent': e.accent }}
                // The chosen one plays or pauses; another switches to it (a crossfade when
                // playing) and plays.
                onClick={() => (selected ? engine.toggle() : engine.play(e.id))}
                title={selected ? (playing ? 'Pause' : 'Play') : `Play ${e.name}`}
              >
                <span className="atm-env-swatch" aria-hidden="true" />
                <span className="atm-env-name">{e.name}</span>
                <span className="atm-env-sub">{e.subtitle}</span>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}

// ---- Customize -------------------------------------------------------------------------

function SaveScene() {
  const engine = getAmbience();
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(null);
  return (
    <form
      className="atm-preset-save"
      onSubmit={(e) => {
        e.preventDefault();
        const scene = engine.saveScene(name);
        if (scene) {
          setSaved(scene.name);
          setName('');
        }
      }}
    >
      <input className="atm-input" aria-label="Scene name" placeholder="Name this sound as a scene" value={name} maxLength={40} onChange={(e) => { setName(e.target.value); setSaved(null); }} />
      <button type="submit" className="atm-btn" disabled={!name.trim()}>Save Scene</button>
      {saved && <span className="atm-hint" role="status">Saved “{saved}” to Your Scenes.</span>}
    </form>
  );
}

function Customize({ state, env, ids }) {
  const engine = getAmbience();
  const evo = EVOLUTION_LABELS[state.evolution];
  return (
    <>
      <section className="atm-section" aria-labelledby={`${ids}-mix`}>
        <h3 id={`${ids}-mix`}>Mix · {env.name}</h3>
        {env.layers.map((layer) => {
          const v = Math.round((state.layers[layer.id] ?? 0) * 100);
          return (
            <label key={layer.id} className="atm-slider-row">
              <span className="atm-slider-label">{layer.label}</span>
              <MacSlider aria-valuetext={`${v}%`} min={0} max={100} value={v} onChange={(x) => engine.setLayerVolume(layer.id, x / 100)} />
              <span className="atm-value">{v}</span>
            </label>
          );
        })}
      </section>

      <section className="atm-section" aria-labelledby={`${ids}-char`}>
        <h3 id={`${ids}-char`}>Character</h3>
        {CHARACTER.map((c) => <RangeRow key={c.id} {...c} value={state.params[c.id]} onChange={(v) => engine.setParameter(c.id, v)} />)}
      </section>

      <section className="atm-section" aria-labelledby={`${ids}-evo`}>
        <h3 id={`${ids}-evo`}>Evolution</h3>
        <div className="atm-row">
          <Segmented
            label="Evolution"
            value={state.evolution}
            onChange={(m) => engine.setEvolution(m)}
            options={EVOLUTION_MODES.map((m) => ({ value: m, label: EVOLUTION_LABELS[m].label, title: EVOLUTION_LABELS[m].hint }))}
          />
          <span className="atm-hint">{evo.hint} Your mix and volume stay as you set them.</span>
        </div>
      </section>

      <section className="atm-section" aria-labelledby={`${ids}-space`}>
        <h3 id={`${ids}-space`}>Stereo</h3>
        {SPACE.map((c) => <RangeRow key={c.id} {...c} value={state.spatial[c.id]} onChange={(v) => engine.setSpatial({ [c.id]: v })} />)}
        <p className="atm-hint">A stereo image: layers placed and drifting left and right. Best with headphones.</p>
      </section>

      <section className="atm-section" aria-labelledby={`${ids}-save`}>
        <h3 id={`${ids}-save`}>Save as a Scene</h3>
        <SaveScene />
      </section>
    </>
  );
}

// ---- Experience ------------------------------------------------------------------------

function FocusSession({ state }) {
  const engine = getAmbience();
  const focus = state.focus;
  const [minutes, setMinutes] = useState(() => state.focusPrefs.minutes);
  const custom = !FOCUS_OPTIONS.includes(minutes);
  return (
    <div className="atm-block">
      <div className="atm-row">
        <span className="atm-row-label">Focus session</span>
        {focus && (
          <span className={`atm-focus-time${focus.status === 'running' ? ' is-running' : ''}`}>
            <FocusTime focus={focus} /> {focus.status === 'running' ? 'left' : 'left · paused'}
          </span>
        )}
      </div>
      {focus ? (
        <>
          {focus.restored && <p className="atm-hint">Restored from before the page closed: paused, with the time that was left.</p>}
          <div className="atm-actions">
            <button type="button" className="atm-btn" onClick={() => engine.toggle()}>{focus.status === 'running' ? 'Pause' : 'Resume'}</button>
            <button type="button" className="atm-btn" onClick={() => engine.extendFocus(10)}>+10 min</button>
            <button type="button" className="atm-btn" onClick={() => engine.cancelFocus()}>End Session</button>
          </div>
        </>
      ) : (
        <>
          <div className="atm-row">
            <Segmented
              label="Session length"
              value={custom ? 'custom' : minutes}
              onChange={(m) => setMinutes(m === 'custom' ? 30 : m)}
              options={[...FOCUS_OPTIONS.map((m) => ({ value: m, label: `${m}m` })), { value: 'custom', label: 'Custom' }]}
            />
            {custom && (
              <label className="atm-custom-min">
                <input type="number" className="atm-input" min={5} max={240} step={5} value={minutes} aria-label="Session minutes" onChange={(e) => setMinutes(Math.max(5, Math.min(240, Math.round(Number(e.target.value) || 5))))} />
                min
              </label>
            )}
            <button type="button" className="atm-btn is-primary" onClick={() => engine.startFocus(minutes)}>Start</button>
          </div>
          <p className="atm-hint">Plays the current sound for the session, fades out near the end and then {state.focusPrefs.end === 'pause' ? 'pauses' : 'stops'}. Pausing the sound pauses the session.</p>
        </>
      )}
      <div className="atm-row">
        <span className="atm-row-label is-secondary">When it ends</span>
        <Segmented small label="When a focus session ends" value={state.focusPrefs.end} onChange={(v) => engine.setFocusEnd(v)} options={[{ value: 'stop', label: 'Stop' }, { value: 'pause', label: 'Pause' }]} />
      </div>
    </div>
  );
}

function SleepTimer({ state }) {
  const engine = getAmbience();
  const now = useTicker(Boolean(state.sleep), 15000);
  const left = state.sleep ? Math.max(0, Math.ceil((state.sleep.endsAt - now) / 60000)) : 0;
  return (
    <div className="atm-row">
      <span className="atm-row-label">Sleep timer</span>
      <Segmented
        label="Sleep timer"
        value={state.sleep?.minutes ?? null}
        onChange={(m) => engine.setSleepTimer(m)}
        options={[null, ...SLEEP_OPTIONS].map((m) => ({ value: m, label: m === null ? 'Off' : m < 60 ? `${m}m` : `${m / 60}h` }))}
      />
      {state.sleep && <span className="atm-hint">Fades out in about {left} min.</span>}
    </div>
  );
}

/** The wallpaper on screen now, and the scene linked to it. */
function WallpaperLink({ state }) {
  const engine = getAmbience();
  const custom = useAmbienceScenes();
  const [ref, setRef] = useState(() => getActiveWallpaper());
  const [label, setLabel] = useState('');
  useEffect(() => subscribeWallpaper((msg) => {
    if (msg?.type === 'active-changed') setRef(getActiveWallpaper());
  }), []);
  const key = wallpaperKey(ref);
  useEffect(() => {
    let alive = true;
    if (!ref) return undefined;
    getWallpaperRecord(ref)
      .then((r) => {
        if (!alive) return;
        const text = r?.name || r?.description || r?.alt_description || (r?.photographer?.name ? `Photo by ${r.photographer.name}` : '');
        setLabel(text ? text.replace(/\.(jpe?g|png|gif)$/i, '') : '');
      })
      .catch(() => alive && setLabel(''));
    return () => { alive = false; };
  }, [ref]);

  if (!key) return <p className="atm-hint">Choose a wallpaper (Settings → Wallpaper) to link a scene to it.</p>;
  return (
    <div className="atm-row">
      <span className="atm-row-label">
        Current wallpaper
        <span className="atm-row-sub">{label || (ref.source === 'unsplash' ? 'Unsplash photo' : 'Your picture')}</span>
      </span>
      <select className="atm-select" aria-label="Scene for the current wallpaper" value={state.links[key] || ''} onChange={(e) => engine.linkWallpaper(key, e.target.value || null)}>
        <option value="">No linked scene</option>
        <optgroup label="Scenes">
          {BUILT_IN_SCENES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </optgroup>
        {custom.length > 0 && (
          <optgroup label="Your Scenes">
            {custom.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </optgroup>
        )}
      </select>
    </div>
  );
}

function Experience({ state, ids }) {
  const engine = getAmbience();
  return (
    <>
      <section className="atm-section" aria-labelledby={`${ids}-focus`}>
        <h3 id={`${ids}-focus`}>Focus</h3>
        <div className="atm-more">
          <FocusSession state={state} />
          <SleepTimer state={state} />
        </div>
      </section>

      <section className="atm-section" aria-labelledby={`${ids}-visual`}>
        <h3 id={`${ids}-visual`}>Visual Effects</h3>
        <div className="atm-more">
          <Switch label="Edge glow" hint="A soft light along the screen’s edges while Atmosphere plays." checked={state.glow.enabled} onChange={(v) => engine.setGlow({ enabled: v })} />
          <Switch label="Glow follows the sound" disabled={!state.glow.enabled} checked={state.glow.reactive} onChange={(v) => engine.setGlow({ reactive: v })} />
          <Switch label="Sound visuals" hint="Live level bars and this window’s scenery. Off: everything stays still." checked={state.visualizer} onChange={(v) => engine.setVisualizer(v)} />
        </div>
      </section>

      <section className="atm-section" aria-labelledby={`${ids}-suggest`}>
        <h3 id={`${ids}-suggest`}>Suggestions</h3>
        <div className="atm-more">
          <Switch label="Match the wallpaper" hint="When you change the wallpaper, suggest a scene that suits it. Never plays by itself." checked={state.suggest.wallpaper} onChange={(v) => engine.setSuggest({ wallpaper: v })} />
          <WallpaperLink state={state} />
          <Switch label="Suggest by time of day" hint="Once each morning, afternoon, evening and night, from this device’s clock." checked={state.suggest.time} onChange={(v) => engine.setSuggest({ time: v })} />
        </div>
      </section>
    </>
  );
}

// ---- the window ------------------------------------------------------------------------

export default function AtmosphereWindow({ open, setOpen, tab: request = null }) {
  const windowRef = useRef(null);
  const overlayRef = useRef(null);
  const menusRef = useRef(null);
  const tabsRef = useRef(null);
  const titleId = useId();
  const state = useAmbience();
  const custom = useAmbienceScenes();
  const engine = getAmbience();
  const env = environmentById(state.environmentId);
  const scene = currentScene(state, custom);
  const [tab, setTabState] = useState(readTab);
  const win = useMacWindow({ app: 'atmosphere', open, setOpen, windowRef, overlayRef, menus: menusRef });
  const playing = state.status === 'playing' || state.status === 'starting';

  // A requested tab ({ tab }: a new object for each request, so asking for the same tab again
  // after moving to another still works), applied while rendering.
  const requested = typeof request === 'string' ? { tab: request } : request;
  const [shownRequest, setShownRequest] = useState(null);
  if (open && requested && request !== shownRequest && TABS.some((t) => t.id === requested.tab)) {
    setShownRequest(request);
    setTabState(requested.tab);
  }

  const setTab = (t) => {
    setTabState(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* a convenience only */ }
  };

  // Menu bar: Controls.
  useEffect(() => {
    menusRef.current = () => ({
      Controls: [
        { label: playing ? 'Pause' : 'Play', onSelect: () => engine.toggle() },
        { label: 'Stop', disabled: !state.session, onSelect: () => engine.stop() },
        { type: 'separator' },
        { label: 'Next Environment', onSelect: () => engine.nextEnvironment() },
        { label: 'Shuffle', onSelect: () => engine.randomize() },
        { type: 'separator' },
        ...EVOLUTION_MODES.map((m) => ({ label: `Evolution: ${EVOLUTION_LABELS[m].label}`, checked: state.evolution === m, onSelect: () => engine.setEvolution(m) })),
      ],
    });
  });

  // Escape closes (not while typing).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) win.close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, win]);

  if (!win.mounted) return null;

  const onTabKey = (e) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = TABS[(i + step + TABS.length) % TABS.length].id;
    setTab(next);
    tabsRef.current?.querySelector(`[data-tab="${next}"]`)?.focus();
  };

  const scenery = state.visualizer && state.status === 'playing';

  return (
    <div ref={overlayRef} className="atm-overlay" onPointerDown={(e) => e.target === e.currentTarget && win.close()}>
      <div
        ref={windowRef}
        className={`atm-window glass-host${win.maximized ? ' window-maximized' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ '--env-accent': env.accent, '--atm-accent': env.accent }}
      >
        <GlassSurface preset="window" />
        {/* The environment's scenery: a few slow CSS lights, only while playing with Sound visuals on. */}
        <div className={`atm-scenery${scenery ? ' is-on' : ''}`} data-env={env.id} aria-hidden="true" />
        <div className="window-controls">
          <span className="window-dot dot-close" role="button" aria-label="Close" onClick={win.close} />
          <span className="window-dot dot-minimize" role="button" aria-label="Minimize" onClick={win.minimize} />
          <span className="window-dot dot-maximize" role="button" aria-label={win.maximized ? 'Exit full size' : 'Zoom'} onClick={win.toggleMaximize} />
        </div>

        <header className="atm-header">
          <AtmosphereGlyph size={34} live={state.status === 'playing'} palette={env.palette} />
          <div className="atm-heading">
            <h2 id={titleId}>Atmosphere</h2>
            <p className={`atm-status${state.status === 'error' ? ' is-error' : ''}`} role="status" aria-live="polite">{statusLine(state, env, scene)}</p>
          </div>
          {state.focus && (
            <span className="atm-header-focus" title="Focus session">
              <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="8" cy="8" r="2.2" fill="currentColor" /></svg>
              <FocusTime focus={state.focus} compact />
            </span>
          )}
        </header>

        <section className="atm-transport" aria-label="Playback">
          <button type="button" className="atm-play" aria-label={playing ? 'Pause' : 'Play'} onClick={() => engine.toggle()}>
            {playing ? Icon.pause : Icon.play}
          </button>
          <button type="button" className="atm-round" aria-label="Stop" title="Stop" disabled={!state.session} onClick={() => engine.stop()}>{Icon.stop}</button>
          <button type="button" className="atm-round" aria-label="Shuffle: a new arrangement" title="Shuffle: a new arrangement" onClick={() => engine.randomize()}>{Icon.shuffle}</button>
          <div className="atm-volume">
            <span className="atm-vol-icon">{Icon.low}</span>
            <MacSlider aria-label="Volume" aria-valuetext={`${Math.round(state.masterVolume * 100)}%`} min={0} max={100} value={Math.round(state.masterVolume * 100)} onChange={(v) => engine.setMasterVolume(v / 100)} />
            <span className="atm-vol-icon">{Icon.high}</span>
          </div>
          <LevelBars live={state.status === 'playing' && state.visualizer} count={5} className="atm-meter" />
        </section>

        <div className="atm-tabs" role="tablist" aria-label="Atmosphere" ref={tabsRef} onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${titleId}-tab-${t.id}`}
              data-tab={t.id}
              aria-selected={tab === t.id}
              aria-controls={`${titleId}-panel`}
              tabIndex={tab === t.id ? 0 : -1}
              className={`atm-tab${tab === t.id ? ' is-on' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="atm-body" role="tabpanel" id={`${titleId}-panel`} aria-labelledby={`${titleId}-tab-${tab}`}>
          {tab === 'explore' && <Explore state={state} playing={playing} ids={titleId} />}
          {tab === 'customize' && <Customize state={state} env={env} ids={titleId} />}
          {tab === 'experience' && <Experience state={state} ids={titleId} />}
        </div>
      </div>
    </div>
  );
}
