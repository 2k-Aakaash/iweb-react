import AtmosphereGlyph from './AtmosphereGlyph';
import LevelBars from './LevelBars';
import FocusTime from './FocusTime';
import MacSlider from '../ui/MacSlider';
import { environmentById } from '../../libs/ambience/environments/index.js';
import { EVOLUTION_LABELS, EVOLUTION_MODES } from '../../libs/ambience/evolution.js';
import { timeLabel, weatherLabel } from '../../libs/ambience/frontier/conditions.js';
import { currentScene, getAmbience, openAtmosphere, openFrontier, useAmbienceScenes } from '../../libs/ambience/store.js';
import WeatherIcon from './WeatherIcon';

const MODE_NAMES = { environmental: 'Ambience', cinematic: 'Cinematic', radio: 'Radio' };
const MODE_ORDER = ['environmental', 'cinematic', 'radio'];

// Atmosphere in the existing Dynamic Island (Music.jsx keeps the island: its container, its
// collapsed / hovered / expanded states, transitions and click-outside). These are the island's
// three content blocks for ambience, in the island's own classes so its geometry and
// animations apply unchanged. Honest: generated ambience has no title, duration or position,
// so none is shown: the level bars are the real output, and the only time shown is a focus
// session's time left.
//
//   collapsed  orb, scene or environment name, level bars (or a focus session's time left)
//   hovered    orb, name and status, level bars
//   expanded   orb (opens the window), name and status, Evolution; volume and level; stop,
//              shuffle, play / pause, next environment, open Atmosphere

const btn = (label, onClick, icon, extra = '') => (
  <button type="button" className={`expanded-control-btn${extra ? ` ${extra}` : ''}`} title={label} aria-label={label} onClick={onClick}>
    {icon}
  </button>
);

export default function AmbienceIsland({ state, expanded }) {
  const engine = getAmbience();
  const scenes = useAmbienceScenes();
  const env = environmentById(state.environmentId);
  const scene = currentScene(state, scenes);
  const playing = state.status === 'playing';
  const live = playing && state.visualizer;
  const name = scene?.name || env.name;
  const focus = state.focus;
  const status = state.status === 'error' ? 'Couldn’t start' : playing ? 'Live' : 'Paused';
  // A Frontier place: its region, the hour and the weather (and the place's name above).
  const frontier = env.frontier && state.conditions;
  const statusText = frontier
    ? `${env.subtitle} · ${timeLabel(state.conditions.time)}, ${weatherLabel(state.conditions.weather).toLowerCase()}${playing ? '' : ` · ${status}`}`
    : scene ? `${env.name} · ${status}` : `Atmosphere · ${status}`;
  const open = () => (frontier ? openFrontier() : openAtmosphere());
  const icon = frontier ? <WeatherIcon weather={state.conditions.weather} night={state.conditions.time === 'night'} size={12} className="island-weather" /> : null;
  const mode = state.frontier?.mode || 'environmental';
  const nextExperience = MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length];
  const volume = Math.round(state.masterVolume * 100);
  const evolution = EVOLUTION_LABELS[state.evolution];
  const nextMode = EVOLUTION_MODES[(EVOLUTION_MODES.indexOf(state.evolution) + 1) % EVOLUTION_MODES.length];

  return (
    <>
      <div className="island-collapsed-content island-ambience">
        <AtmosphereGlyph size={22} live={playing} palette={env.palette} className="island-art" />
        <span className="island-elapsed-time island-ambience-name">{name}</span>
        {focus
          ? <FocusTime focus={focus} compact className="island-ambience-focus" />
          : <LevelBars live={live} />}
      </div>

      <div className="island-hovered-content island-ambience">
        <AtmosphereGlyph size={24} live={playing} palette={env.palette} className="island-art" />
        <div className="island-info">
          <span className="island-title">{name}</span>
          <span className="island-artist">
            {focus ? <>Focus · <FocusTime focus={focus} compact /> left</> : <>{icon}{statusText}</>}
          </span>
        </div>
        <LevelBars live={live} />
      </div>

      {expanded && (
        <div className="island-expanded-content island-ambience">
          <div className="expanded-top-row">
            <button type="button" className="island-ambience-open" aria-label="Open Atmosphere" title="Open Atmosphere" onClick={open}>
              <AtmosphereGlyph size={40} live={playing} palette={env.palette} className="island-art-large" />
            </button>
            <div className="expanded-info">
              <span className="expanded-title">{name}</span>
              <span className="expanded-artist" role="status">
                {state.notice || (focus ? <>Focus · <FocusTime focus={focus} compact /> left{focus.status === 'paused' ? ' · paused' : ''}</> : <>{icon}{statusText}</>)}
              </span>
            </div>
            {frontier ? (
              <button
                type="button"
                className={`island-evolution island-mode${mode === 'environmental' ? ' is-off' : ''}`}
                title={`Experience: ${MODE_NAMES[mode]}. Click for ${MODE_NAMES[nextExperience]}.`}
                aria-label={`Experience: ${MODE_NAMES[mode]}. Change to ${MODE_NAMES[nextExperience]}`}
                onClick={() => engine.setMode(nextExperience)}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 12V4l8-1.5v8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><circle cx="3.6" cy="12" r="1.6" fill="currentColor" /><circle cx="11.6" cy="10.5" r="1.6" fill="currentColor" /></svg>
                {MODE_NAMES[mode]}
              </button>
            ) : (
            <button
              type="button"
              className={`island-evolution${state.evolution === 'off' ? ' is-off' : ''}`}
              title={`Evolution: ${evolution.label}. ${evolution.hint} Click for ${EVOLUTION_LABELS[nextMode].label}.`}
              aria-label={`Evolution: ${evolution.label}. Change to ${EVOLUTION_LABELS[nextMode].label}`}
              onClick={() => engine.setEvolution(nextMode)}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 10c2-4 3.5-4 5 0s3 4 5 0 2-2 2-2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              {evolution.label}
            </button>
            )}
          </div>
          {/* Volume (a real control, with its value) and the live level: not a timeline. */}
          <div className="island-ambience-volume" data-force-dark>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" /></svg>
            <MacSlider
              className="island-ambience-slider"
              aria-label="Atmosphere volume"
              aria-valuetext={`${volume}%`}
              min={0}
              max={100}
              value={volume}
              onChange={(v) => engine.setMasterVolume(v / 100)}
            />
            <span className="island-ambience-value" aria-hidden="true">{volume}%</span>
            <LevelBars live={live} count={5} className="expanded-waveform" />
          </div>
          <div className="expanded-controls-row">
            {btn('Stop', () => engine.stop(), <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="6.5" width="11" height="11" rx="2" /></svg>)}
            <div className="controls-center">
              {btn('Shuffle: a new arrangement', () => engine.randomize(), <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>)}
              {btn(playing ? 'Pause' : 'Play', () => engine.toggle(), playing
                ? <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                : <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>, 'btn-play')}
              {btn(frontier ? 'Next place in this region' : 'Next environment', () => engine.nextEnvironment(), <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 6v12l8.5-6L12 6zM3.5 6v12L12 12 3.5 6z" /></svg>)}
            </div>
            {btn('Open Atmosphere', open, <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>)}
          </div>
        </div>
      )}
    </>
  );
}
