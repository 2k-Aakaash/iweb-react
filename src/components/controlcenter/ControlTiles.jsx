import GlassSurface from '../glass/GlassSurface';
import { CONTROLS } from '../../libs/controlcenter/controls';
import { focusPref, nightShiftPref, wallpaperBrightnessPref, widgetsHiddenPref, MIN_BRIGHTNESS } from '../../libs/controlcenter/ccPrefs';
import { usePref } from '../../libs/prefs/storedPref';
import { setClockStyle, useClockStyle } from '../../libs/clock/clockStyle';
import { connectionSummary, useConnection } from '../../libs/controlcenter/connection';
import { formatRemaining, isActive, isRunning, remainingAt, useTicker, useTimer } from '../../libs/controlcenter/timer';
import { nextTrack, openMusic, playPause, previousTrack, setPlayerVolume, toggleMute, usePlayer } from '../../libs/music/playerStore';
import { useFullscreen } from '../menubar/status';
import {
  AudioOutputIcon, BackwardIcon, CalculatorIcon, ChevronRightIcon, EditWidgetsIcon, ForwardIcon, FullscreenIcon,
  GlassClockIcon, MoonIcon, MusicNoteIcon, NightShiftIcon, PauseIcon, PlayIcon, ScreenshotIcon, ShowDesktopIcon,
  SpeakerIcon, SpeakerMutedIcon, SunIcon, TimerIcon, WidgetsIcon, WifiIcon,
} from './ccIcons';

// One Control Center tile per control (libs/controlcenter/controls.js), in macOS 26's shapes:
// round buttons, pills, the Now Playing square and full-width sliders, on Liquid Glass. A
// switched-on button turns white with a blue glyph, as on macOS.
//
// `ctx`: { openView(view), close(), run(fn) } from ControlCenter.jsx — run() closes Control
// Center first, then does something on the page (Show Desktop, Screenshot…).

function Glass() {
  return <GlassSurface preset="card" />;
}

function RoundTile({ label, on = false, disabled = false, onClick, children }) {
  return (
    <button
      type="button"
      className={`cc-tile cc-round${on ? ' is-on' : ' glass-host'}`}
      aria-label={label}
      aria-pressed={on}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {!on && <Glass />}
      <span className="cc-round-glyph">{children}</span>
    </button>
  );
}

function PillTile({ label, detail, on = false, icon, onClick, onIconClick, chevron = false, iconLabel }) {
  return (
    <div className="cc-tile cc-pill glass-host">
      <Glass />
      <button
        type="button"
        className={`cc-pill-icon${on ? ' is-on' : ''}`}
        aria-label={iconLabel || label}
        aria-pressed={onIconClick ? on : undefined}
        onClick={onIconClick || onClick}
      >
        {icon}
      </button>
      <button type="button" className="cc-pill-text" onClick={onClick}>
        <span className="cc-pill-label">{label}</span>
        {detail && <span className="cc-pill-detail">{detail}</span>}
        {chevron && <span className="cc-pill-chevron"><ChevronRightIcon size={11} /></span>}
      </button>
    </div>
  );
}

function SliderTile({ title, value, min = 0, max = 100, onChange, label, start, end }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="cc-tile cc-slider-tile glass-host">
      <Glass />
      <span className="cc-wide-title">{title}</span>
      <div className="cc-slider-row">
        {start}
        <input
          type="range"
          className="cc-slider"
          min={min}
          max={max}
          value={value}
          aria-label={label}
          style={{ '--cc-fill': `${pct}%` }}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {end}
      </div>
    </div>
  );
}

function ConnectionTile({ ctx }) {
  const c = useConnection();
  return (
    <PillTile
      label="Wi-Fi"
      detail={connectionSummary(c)}
      on={c.online}
      icon={<WifiIcon size={17} off={!c.online} />}
      onClick={() => ctx.openView('connection')}
      iconLabel="Network details"
    />
  );
}

function NowPlayingTile({ ctx }) {
  const player = usePlayer();
  const { track } = player;
  const open = () => ctx.run(openMusic);
  return (
    <div className="cc-tile cc-now-playing glass-host">
      <Glass />
      <button type="button" className="cc-np-art" onClick={open} aria-label="Open Music">
        {track?.artwork ? <img src={track.artwork} alt="" /> : <MusicNoteIcon size={22} />}
      </button>
      <button type="button" className="cc-np-text" onClick={open}>
        <span className="cc-np-title">{track ? track.title : 'Not Playing'}</span>
        <span className="cc-np-artist">{track ? track.artist || 'Unknown Artist' : 'Choose a music folder'}</span>
      </button>
      <div className="cc-np-controls">
        <button type="button" aria-label="Previous" disabled={!player.available} onClick={previousTrack}><BackwardIcon size={20} /></button>
        <button type="button" className="cc-np-play" aria-label={player.playing ? 'Pause' : 'Play'} disabled={!player.available} onClick={playPause}>
          {player.playing ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
        </button>
        <button type="button" aria-label="Next" disabled={!player.available} onClick={nextTrack}><ForwardIcon size={20} /></button>
      </div>
    </div>
  );
}

function FocusTile() {
  const focus = usePref(focusPref);
  return (
    <PillTile
      label="Focus"
      detail={focus ? 'On' : null}
      on={focus}
      icon={<MoonIcon size={17} />}
      onClick={() => focusPref.set(!focus)}
    />
  );
}

function DisplayTile() {
  const brightness = usePref(wallpaperBrightnessPref);
  return (
    <SliderTile
      title="Display"
      label="Wallpaper brightness"
      value={brightness}
      min={MIN_BRIGHTNESS}
      onChange={(v) => wallpaperBrightnessPref.set(v)}
      start={<span className="cc-slider-icon"><SunIcon size={15} /></span>}
      end={<span className="cc-slider-icon"><SunIcon size={18} large /></span>}
    />
  );
}

function SoundTile({ ctx }) {
  const player = usePlayer();
  const shown = player.muted ? 0 : player.volume;
  const level = shown === 0 ? 0 : shown < 34 ? 1 : shown < 67 ? 2 : 3;
  return (
    <SliderTile
      title="Sound"
      label="Music volume"
      value={shown}
      onChange={(v) => {
        if (player.muted && v > 0) toggleMute();
        setPlayerVolume(v);
      }}
      start={(
        <button type="button" className="cc-slider-icon cc-slider-btn" aria-label={player.muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>
          {player.muted || shown === 0 ? <SpeakerMutedIcon size={17} /> : <SpeakerIcon size={17} level={Math.min(level, 1)} />}
        </button>
      )}
      end={(
        <>
          <span className="cc-slider-icon"><SpeakerIcon size={19} level={3} /></span>
          <button type="button" className="cc-output-btn" aria-label="Sound output" title="Sound Output" onClick={() => ctx.openView('sound')}>
            <AudioOutputIcon size={15} />
          </button>
        </>
      )}
    />
  );
}

function TimerTile({ ctx }) {
  const timer = useTimer();
  const now = useTicker(isRunning(timer), 500);
  const active = isActive(timer);
  const left = formatRemaining(remainingAt(timer, now));
  const label = timer.done ? 'Timer ended' : active ? `Timer, ${left} left` : 'Timer';
  return (
    <RoundTile label={label} on={active} onClick={() => ctx.openView('timer')}>
      {active && !timer.done
        ? <span className={`cc-round-time${isRunning(timer) ? '' : ' is-paused'}`}>{left}</span>
        : <TimerIcon size={22} />}
    </RoundTile>
  );
}

function ToggleTile({ id, pref, invert = false, icon }) {
  const value = usePref(pref);
  const on = invert ? !value : value;
  return (
    <RoundTile label={CONTROLS[id].label} on={on} onClick={() => pref.set(!value)}>
      {icon}
    </RoundTile>
  );
}

function GlassClockTile() {
  const glass = useClockStyle() === 'glass';
  return (
    <RoundTile label={glass ? 'Glass Clock' : 'Glass Clock (Vibrant Colour now)'} on={glass} onClick={() => setClockStyle(glass ? 'vibrant' : 'glass')}>
      <GlassClockIcon size={22} />
    </RoundTile>
  );
}

function FullscreenTile() {
  const fullscreen = useFullscreen();
  const toggle = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  return (
    <RoundTile label={fullscreen ? 'Exit Full Screen' : 'Enter Full Screen'} on={fullscreen} onClick={toggle}>
      <FullscreenIcon size={21} exit={fullscreen} />
    </RoundTile>
  );
}

export default function ControlTile({ id, ctx }) {
  switch (id) {
    case 'connection': return <ConnectionTile ctx={ctx} />;
    case 'nowPlaying': return <NowPlayingTile ctx={ctx} />;
    case 'widgets': return <ToggleTile id="widgets" pref={widgetsHiddenPref} invert icon={<WidgetsIcon size={21} />} />;
    case 'glassClock': return <GlassClockTile />;
    case 'focus': return <FocusTile />;
    case 'showDesktop': return <RoundTile label="Show Desktop" onClick={() => ctx.run(ctx.showDesktop)}><ShowDesktopIcon size={22} /></RoundTile>;
    case 'editWidgets': return <RoundTile label="Edit Widgets" onClick={() => ctx.run(ctx.editWidgets)}><EditWidgetsIcon size={21} /></RoundTile>;
    case 'display': return <DisplayTile />;
    case 'sound': return <SoundTile ctx={ctx} />;
    case 'nightShift': return <ToggleTile id="nightShift" pref={nightShiftPref} icon={<NightShiftIcon size={21} />} />;
    case 'calculator': return <RoundTile label="Calculator" onClick={() => ctx.openView('calculator')}><CalculatorIcon size={22} /></RoundTile>;
    case 'timer': return <TimerTile ctx={ctx} />;
    case 'screenshot': return <RoundTile label="Screenshot" onClick={() => ctx.run(ctx.screenshot)}><ScreenshotIcon size={22} /></RoundTile>;
    case 'fullscreen': return <FullscreenTile />;
    default: return null;
  }
}
