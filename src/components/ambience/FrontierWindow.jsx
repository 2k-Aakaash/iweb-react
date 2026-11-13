import { useEffect, useId, useRef, useState } from 'react';
import GlassSurface from '../glass/GlassSurface';
import MacSlider from '../ui/MacSlider';
import LevelBars from './LevelBars';
import LayerRow from './LayerRow';
import WeatherIcon from './WeatherIcon';
import FrontierScenery, { BlendedScenery } from './FrontierScenery';
import { useMacWindow } from '../../libs/window/useMacWindow';
import { environmentById } from '../../libs/ambience/environments/index.js';
import { LOCATIONS, REGIONS, WORLD, locationById, locationsIn, regionById } from '../../libs/ambience/frontier/catalogue.js';
import { effectiveConditions, regionWeathers, TIMES, timeLabel, WEATHERS, weatherLabel, weatherNote } from '../../libs/ambience/frontier/conditions.js';
import { EVENTS } from '../../libs/ambience/frontier/events.js';
import { MOODS, MOOD_IDS } from '../../libs/ambience/frontier/music.js';
import { clockLabel } from '../../libs/ambience/frontier/world.js';
import { SPEEDS } from '../../libs/ambience/prefs.js';
import { getAmbience, useAmbience } from '../../libs/ambience/store.js';
import '../../styles/atmosphere.css';
import '../../styles/frontier.css';

// Frontier World: its own window (useMacWindow: genie into its Dock icon, move, resize, snap),
// on the one Atmosphere engine. Three columns and a strip:
//   left     destinations and their places (choosing a place plays it, with a crossfade)
//   centre   the place: its landscape at this hour and in this weather, what it is
//   right    the experience mode, time, weather, intensities, music and the layers
//   bottom   Now Playing: play / pause, stop, the place, the hour and weather, the volume
// On a narrow window the side columns become sheets, opened from the toolbar. Every control
// calls the engine, and only the engine's state is shown (the island shows the same).

const MODES = [
  { value: 'environmental', label: 'Environmental', hint: 'The place itself: ambience only.' },
  { value: 'cinematic', label: 'Cinematic', hint: 'Original music under the ambience, kept quiet.' },
  { value: 'radio', label: 'Frontier Radio', hint: 'Music first: generated songs, the place softly behind them.' },
];
const TIME_MODES = [
  { value: 'fixed', label: 'Fixed', hint: 'The hour stays as chosen.' },
  { value: 'local', label: 'Real Time', hint: 'Follows this device’s clock.' },
  { value: 'accelerated', label: 'Accelerated', hint: 'A day passes faster, while it plays.' },
];
const WEATHER_MODES = [
  { value: 'locked', label: 'Locked', hint: 'The weather stays as chosen, at every place, until you reset it.' },
  { value: 'simulated', label: 'Simulated', hint: 'Weather comes and goes by itself, slowly, as the destination’s climate allows. Rain arrives as a front.' },
];
const SPEED_LABEL = { 2: 'A day in 12 hours', 6: 'A day in 4 hours', 12: 'A day in 2 hours', 24: 'A day in 1 hour' };

const Icon = {
  play: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>,
  pause: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /></svg>,
  stop: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" /></svg>,
  chevron: <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  close: <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>,
};

function Segmented({ label, options, value, onChange, disabled = false }) {
  return (
    <div className="atm-seg fr-seg" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} disabled={disabled} title={o.hint} className={`atm-seg-btn${on ? ' is-on' : ''}`} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Range({ label, value, onChange, disabled = false, low, high }) {
  const v = Math.round(value * 100);
  return (
    <label className="atm-slider-row fw-range">
      <span className="atm-slider-label">{label}</span>
      <MacSlider aria-valuetext={low && high ? `${v}%: ${v < 34 ? low : v > 66 ? high : 'as designed'}` : `${v}%`} disabled={disabled} min={0} max={100} value={v} onChange={(x) => onChange(x / 100)} />
      <span className="atm-value">{v}</span>
    </label>
  );
}

/** The place being shown: the playing Frontier place, or the last one visited. */
function shownPlace(state) {
  return locationById(state.environmentId) || locationById(state.frontier.locationId) || LOCATIONS[0];
}

// ---- left: destinations and places ------------------------------------------------------

function Places({ state, place, onChosen, ids }) {
  const engine = getAmbience();
  const [open, setOpen] = useState(() => new Set([place.regionId]));
  const playing = state.status === 'playing';
  const toggle = (id) => setOpen((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  return (
    <nav className="fw-places" aria-label="Destinations and places">
      <h3 className="fw-col-title" id={`${ids}-dest`}>Destinations</h3>
      <ul className="fw-dest-list" aria-labelledby={`${ids}-dest`}>
        {REGIONS.map((r) => {
          const expanded = open.has(r.id);
          const listId = `${ids}-${r.id}`;
          return (
            <li key={r.id} className={`fw-dest${r.id === place.regionId ? ' is-current' : ''}`} style={{ '--fr-accent': r.accent }}>
              <button type="button" className="fw-dest-btn" aria-expanded={expanded} aria-controls={listId} onClick={() => toggle(r.id)}>
                <FrontierScenery regionId={r.id} locationId={locationsIn(r.id)[0].id} time={locationsIn(r.id)[0].time} weather="clear" className="fw-dest-art" />
                <span className="fw-dest-name">{r.name}</span>
                <span className={`fw-chevron${expanded ? ' is-open' : ''}`}>{Icon.chevron}</span>
              </button>
              {expanded && (
                <ul className="fw-place-list" id={listId}>
                  {locationsIn(r.id).map((l) => {
                    const active = state.environmentId === l.id;
                    return (
                      <li key={l.id}>
                        <button
                          type="button"
                          className={`fw-place${active ? ' is-active' : ''}`}
                          aria-current={active ? 'true' : undefined}
                          title={active ? undefined : `Listen to ${l.name}`}
                          onClick={() => {
                            if (!active) engine.openLocation(l.id, { play: true });
                            else if (!playing) engine.play();
                            onChosen();
                          }}
                        >
                          <span className="fw-place-name">{l.name}</span>
                          {active && <span className="fr-badge">{playing ? 'Playing' : 'Paused'}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ---- centre: the place ------------------------------------------------------------------

function Scene({ state, place, cond, here }) {
  const engine = getAmbience();
  const region = regionById(place.regionId);
  const night = cond.time === 'night';
  return (
    <section className="fw-scene" aria-label={`${place.name}, ${region.name}`} style={{ '--fr-accent': region.accent }}>
      <BlendedScenery regionId={place.regionId} locationId={place.id} time={cond.time} weather={cond.weather} className="fw-scene-art" />
      <div className="fw-scene-top" data-force-dark>
        <span className="fr-chip fw-cond-chip">
          <WeatherIcon weather={cond.weather} night={night} />
          {cond.clock !== null ? `${clockLabel(cond.clock)} · ` : ''}{timeLabel(cond.time)} · {weatherLabel(cond.weather)}
        </span>
        {cond.front && <span className="fr-chip fw-front-chip" role="status"><WeatherIcon weather={cond.front} /> {weatherLabel(cond.front)} on its way</span>}
      </div>
      <div className="fr-hero-text fw-scene-text" data-force-dark>
        <span className="fr-hero-kicker">{region.name}</span>
        <h2 className="fr-hero-title">{place.name}</h2>
        <p className="fr-hero-desc">{place.description}</p>
        <p className="fw-character">
          <span>Water: {place.character.water}</span>
          <span>Wind: {place.character.wind}</span>
          <span>Growth: {place.character.vegetation}</span>
        </p>
        {!here && (
          <div className="fr-hero-actions">
            <button type="button" className="atm-btn is-primary" onClick={() => engine.openLocation(place.id, { play: true })}>Listen to {place.name}</button>
            <span className="fr-status">{state.status === 'playing' ? `Now playing: ${environmentById(state.environmentId)?.name}` : 'Not playing'}</span>
          </div>
        )}
      </div>
    </section>
  );
}

// ---- right: the controls ----------------------------------------------------------------

function Controls({ state, place, cond, here, ids }) {
  const engine = getAmbience();
  const f = state.frontier;
  const weathers = regionWeathers(place.regionId);
  const env = environmentById(place.id);
  const musicOn = f.mode !== 'environmental';
  const musicVolume = f.mode === 'radio' ? f.music.radioVolume : f.music.cinematicVolume;
  const events = place.events.map((id) => EVENTS[id]?.label).filter(Boolean);
  const timeHint = TIME_MODES.find((m) => m.value === f.timeMode)?.hint;
  const weatherHint = WEATHER_MODES.find((m) => m.value === f.weatherMode)?.hint;
  return (
    <div className="fw-controls" aria-label="Frontier controls">
      <section className="fw-section" aria-labelledby={`${ids}-mode`}>
        <h3 id={`${ids}-mode`}>Experience</h3>
        <Segmented label="Experience" value={f.mode} onChange={(m) => engine.setMode(m)} options={MODES} />
        <p className="atm-hint">{MODES.find((m) => m.value === f.mode)?.hint}</p>
      </section>

      <section className="fw-section" aria-labelledby={`${ids}-time`}>
        <h3 id={`${ids}-time`}>Time{cond.clock !== null && <span className="fw-clock">{clockLabel(cond.clock)}</span>}</h3>
        <Segmented label="How time passes" value={f.timeMode} onChange={(m) => engine.setTimeMode(m)} options={TIME_MODES} />
        <Segmented
          label={f.timeMode === 'accelerated' ? 'Start the day from' : 'Time of day'}
          value={cond.time}
          disabled={f.timeMode === 'local'}
          onChange={(t) => engine.setConditions({ time: t })}
          options={TIMES.map((t) => ({ value: t.id, label: t.label }))}
        />
        {f.timeMode === 'accelerated' && (
          <Segmented label="Speed" value={f.speed} onChange={(v) => engine.setSpeed(v)} options={SPEEDS.map((v) => ({ value: v, label: `${v}×`, hint: SPEED_LABEL[v] }))} />
        )}
        <p className="atm-hint">
          {timeHint}
          {f.timeMode === 'accelerated' && ` ${SPEED_LABEL[f.speed]}.`}
          {f.timeMode === 'local' && ' Choosing an hour fixes it there.'}
        </p>
      </section>

      <section className="fw-section" aria-labelledby={`${ids}-weather`}>
        <h3 id={`${ids}-weather`}>Weather</h3>
        <Segmented label="How weather changes" value={f.weatherMode} onChange={(m) => engine.setWeatherMode(m)} options={WEATHER_MODES} />
        <Segmented
          label={f.weatherMode === 'simulated' ? 'Weather now (choose one to start from)' : 'Weather'}
          value={cond.weather}
          onChange={(w) => engine.setConditions({ weather: w })}
          options={WEATHERS.filter((w) => weathers.includes(w.id)).map((w) => ({ value: w.id, label: w.label }))}
        />
        <p className="atm-hint">{weatherHint}</p>
        <div className="atm-actions">
          <button type="button" className="atm-btn" disabled={f.timeMode !== 'accelerated' && f.weatherMode !== 'simulated' && !f.time && !f.weather} onClick={() => engine.resetConditions()}>
            Reset to {place.name}’s own ({timeLabel(place.time)}, {weatherLabel(place.weather).toLowerCase()})
          </button>
        </div>
      </section>

      <section className="fw-section" aria-labelledby={`${ids}-mix`}>
        <h3 id={`${ids}-mix`}>Intensity</h3>
        <Range label="Events" value={f.eventIntensity} onChange={(v) => engine.setEventIntensity(v)} low="rare" high="frequent" />
        <Range label="Weather" value={f.weatherIntensity} onChange={(v) => engine.setWeatherIntensity(v)} low="light" high="strong" />
        <Range label="Ambience" value={f.ambienceVolume} onChange={(v) => engine.setAmbienceVolume(v)} />
        <Range label={f.mode === 'radio' ? 'Radio volume' : 'Music volume'} value={musicVolume} disabled={!musicOn} onChange={(v) => engine.setMusic({ volume: v })} />
        <div className="atm-row">
          <span className="atm-row-label">Music mood</span>
          <select className="atm-select" aria-label="Music mood" value={f.music.mood} disabled={!musicOn} onChange={(e) => engine.setMusic({ mood: e.target.value })}>
            <option value="auto">Auto{here && state.musicMood ? `: ${MOODS[state.musicMood].label}` : ''}</option>
            {MOOD_IDS.map((id) => <option key={id} value={id}>{MOODS[id].label}</option>)}
          </select>
        </div>
        {!musicOn && <p className="atm-hint">Music plays in Cinematic and Frontier Radio.</p>}
      </section>

      <section className="fw-section" aria-labelledby={`${ids}-layers`}>
        <h3 id={`${ids}-layers`}>Layers</h3>
        {here ? env.layers.map((layer) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            value={state.layers[layer.id] ?? layer.level}
            muted={Boolean(state.muted?.[layer.id])}
            note={layer.kind === 'weather' ? weatherNote(cond.weather) : null}
          />
        )) : <p className="atm-hint">Listen to {place.name} to mix its layers.</p>}
      </section>

      {events.length > 0 && (
        <section className="fw-section" aria-labelledby={`${ids}-life`}>
          <h3 id={`${ids}-life`}>Now and Then</h3>
          <p className="atm-hint">When the hour and weather suit it: {events.join(', ').toLowerCase()}. One at a time, sometimes answered from further off.</p>
        </section>
      )}
    </div>
  );
}

// ---- bottom: Now Playing ----------------------------------------------------------------

function NowStrip({ state, place, cond, here }) {
  const engine = getAmbience();
  const playing = state.status === 'playing' || state.status === 'starting';
  const region = regionById(place.regionId);
  const volume = Math.round(state.masterVolume * 100);
  const status = state.status === 'error' ? state.error : state.notice;
  return (
    <section className="fw-strip" aria-label="Now playing">
      <button
        type="button"
        className="atm-play fw-play"
        aria-label={playing && here ? 'Pause' : `Play ${place.name}`}
        onClick={() => (here ? engine.toggle() : engine.openLocation(place.id, { play: true }))}
      >
        {playing && here ? Icon.pause : Icon.play}
      </button>
      <button type="button" className="atm-round" aria-label="Stop" title="Stop" disabled={!state.session} onClick={() => engine.stop()}>{Icon.stop}</button>
      <div className="fw-strip-text">
        <span className="fw-strip-name">{here ? place.name : 'Frontier World'}</span>
        <span className="fw-strip-sub" role="status" aria-live="polite">
          {status || (here
            ? <><WeatherIcon weather={cond.weather} night={cond.time === 'night'} /> {region.name} · {cond.clock !== null ? `${clockLabel(cond.clock)}, ` : ''}{timeLabel(cond.time).toLowerCase()}, {weatherLabel(cond.weather).toLowerCase()}{state.status === 'paused' ? ' · paused' : ''}</>
            : `Choose a place, or play ${place.name}`)}
        </span>
      </div>
      {here && state.frontier.mode !== 'environmental' && <span className="fr-badge fw-mode-badge">{state.frontier.mode === 'radio' ? 'Radio' : 'Cinematic'}</span>}
      <div className="atm-volume fw-volume">
        <MacSlider aria-label="Volume" aria-valuetext={`${volume}%`} min={0} max={100} value={volume} onChange={(v) => engine.setMasterVolume(v / 100)} />
      </div>
      <LevelBars live={state.status === 'playing' && state.visualizer && here} count={5} className="atm-meter" />
    </section>
  );
}

// ---- the window -------------------------------------------------------------------------

export default function FrontierWindow({ open, setOpen }) {
  const windowRef = useRef(null);
  const overlayRef = useRef(null);
  const menusRef = useRef(null);
  const ids = useId();
  const state = useAmbience();
  const engine = getAmbience();
  const win = useMacWindow({ app: 'frontier', open, setOpen, windowRef, overlayRef, menus: menusRef });
  const [sheet, setSheet] = useState(null); // narrow windows: 'places' | 'controls'
  const place = shownPlace(state);
  const here = state.environmentId === place.id;
  const cond = here && state.conditions ? state.conditions : { ...effectiveConditions(place, state.frontier), clock: null, front: null };
  const playing = here && (state.status === 'playing' || state.status === 'starting');

  // Menu bar: Controls.
  useEffect(() => {
    menusRef.current = () => ({
      Controls: [
        { label: playing ? 'Pause' : 'Play', onSelect: () => (here ? engine.toggle() : engine.openLocation(place.id, { play: true })) },
        { label: 'Stop', disabled: !state.session, onSelect: () => engine.stop() },
        { label: 'Next Place in Destination', disabled: !here, onSelect: () => engine.nextEnvironment() },
        { type: 'separator' },
        ...MODES.map((m) => ({ label: m.label, checked: state.frontier.mode === m.value, onSelect: () => engine.setMode(m.value) })),
      ],
    });
  });

  // Escape closes a sheet first, then the window (never while typing).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (sheet) setSheet(null);
      else win.close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, win, sheet]);

  if (!win.mounted) return null;

  return (
    <div ref={overlayRef} className="atm-overlay fw-overlay" onPointerDown={(e) => e.target === e.currentTarget && win.close()}>
      <div
        ref={windowRef}
        className={`atm-window fw-window glass-host${win.maximized ? ' window-maximized' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        tabIndex={-1}
        style={{ '--env-accent': regionById(place.regionId).accent, '--atm-accent': regionById(place.regionId).accent }}
      >
        <GlassSurface preset="window" />
        <div className="window-controls">
          <span className="window-dot dot-close" role="button" aria-label="Close" onClick={win.close} />
          <span className="window-dot dot-minimize" role="button" aria-label="Minimize" onClick={win.minimize} />
          <span className="window-dot dot-maximize" role="button" aria-label={win.maximized ? 'Exit full size' : 'Zoom'} onClick={win.toggleMaximize} />
        </div>
        <header className="fw-toolbar">
          <h1 id={`${ids}-title`} className="fw-title">{WORLD.name}</h1>
          <div className="fw-sheet-btns">
            <button type="button" className="atm-btn fw-sheet-btn" aria-expanded={sheet === 'places'} onClick={() => setSheet(sheet === 'places' ? null : 'places')}>Places</button>
            <button type="button" className="atm-btn fw-sheet-btn" aria-expanded={sheet === 'controls'} onClick={() => setSheet(sheet === 'controls' ? null : 'controls')}>Controls</button>
          </div>
        </header>
        <div className="fw-body">
          <div className={`fw-col fw-left${sheet === 'places' ? ' is-open' : ''}`}>
            <button type="button" className="atm-icon-btn fw-sheet-close" aria-label="Close places" onClick={() => setSheet(null)}>{Icon.close}</button>
            <Places state={state} place={place} onChosen={() => setSheet(null)} ids={ids} />
          </div>
          <Scene state={state} place={place} cond={cond} here={here} />
          <div className={`fw-col fw-right${sheet === 'controls' ? ' is-open' : ''}`}>
            <button type="button" className="atm-icon-btn fw-sheet-close" aria-label="Close controls" onClick={() => setSheet(null)}>{Icon.close}</button>
            <Controls state={state} place={place} cond={cond} here={here} ids={ids} />
          </div>
        </div>
        <NowStrip state={state} place={place} cond={cond} here={here} />
      </div>
    </div>
  );
}
