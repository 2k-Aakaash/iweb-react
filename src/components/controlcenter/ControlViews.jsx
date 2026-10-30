import { useEffect, useReducer, useState } from 'react';
import GlassSurface from '../glass/GlassSurface';
import { connectionSummary, speedLabel, useConnection } from '../../libs/controlcenter/connection';
import { actionForKey, calculate, clearLabel, initialCalc } from '../../libs/controlcenter/calculator';
import {
  MAX_MINUTES, PRESETS_MIN, cancelTimer, formatRemaining, isActive, isRunning, pauseTimer, remainingAt, resumeTimer,
  startTimer, useTicker, useTimer,
} from '../../libs/controlcenter/timer';
import { setOutputDevice, setPlayerVolume, toggleMute, usePlayer } from '../../libs/music/playerStore';
import { AudioOutputIcon, CheckIcon, ChevronLeftIcon, SpeakerIcon, SpeakerMutedIcon, WifiIcon } from './ccIcons';

// The views Control Center opens in place of its grid, as macOS opens a module: network
// details, the sound output, a calculator and the timer. Each has a back button; Escape goes
// back too (ControlCenter.jsx).

function ViewShell({ title, onBack, children, className = '' }) {
  return (
    <section className={`cc-view glass-host ${className}`} aria-label={title}>
      <GlassSurface preset="card" />
      <header className="cc-view-head">
        <button type="button" className="cc-view-back" onClick={onBack} aria-label="Back to Control Center">
          <ChevronLeftIcon size={13} />
        </button>
        <h2>{title}</h2>
      </header>
      {children}
    </section>
  );
}

// ---- Wi-Fi --------------------------------------------------------------------------------

function ConnectionView({ onBack }) {
  const c = useConnection();
  const rows = [
    ['Status', c.online ? 'Connected to the internet' : 'Not connected'],
    ['Connection', connectionSummary(c)],
    c.effectiveType && ['Speed', `${speedLabel(c)} (${c.effectiveType.toUpperCase()}-class)`],
    c.downlink !== null && ['Bandwidth', `≈ ${c.downlink} Mbit/s`],
    c.rtt !== null && ['Latency', `≈ ${c.rtt} ms`],
    c.saveData && ['Data Saver', 'On'],
  ].filter(Boolean);
  return (
    <ViewShell title="Wi-Fi" onBack={onBack}>
      <div className="cc-net-hero">
        <span className={`cc-net-icon${c.online ? ' is-on' : ''}`}><WifiIcon size={22} off={!c.online} /></span>
        <div>
          <strong>{c.online ? 'Online' : 'Offline'}</strong>
          <span>{c.online ? 'iWeb can reach the internet.' : 'Widgets show what they saved last.'}</span>
        </div>
      </div>
      <dl className="cc-rows">
        {rows.map(([label, value]) => (
          <div key={label} className="cc-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="cc-note">Browsers can't switch Wi-Fi or show the network's name; your system's settings can.</p>
    </ViewShell>
  );
}

// ---- Sound output -------------------------------------------------------------------------

const canChooseOutput = () => typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;

function useOutputs() {
  const [outputs, setOutputs] = useState([]);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices?.enumerateDevices?.()
      .then((devices) => {
        if (!cancelled) setOutputs(devices.filter((d) => d.kind === 'audiooutput'));
      })
      .catch(() => {});
    const onChange = () => setVersion((v) => v + 1);
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
    };
  }, [version]);
  return { outputs, refresh: () => setVersion((v) => v + 1) };
}

function SoundView({ onBack }) {
  const player = usePlayer();
  const { outputs, refresh } = useOutputs();
  const [error, setError] = useState('');
  const named = outputs.some((d) => d.label);
  const supported = canChooseOutput();
  const selected = player.outputId || 'default';

  // Chrome hides device names until the page may use a microphone; asking once reveals them.
  const showNames = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      refresh();
    } catch {
      setError('Device names stay hidden without that permission.');
    }
  };

  const choose = async (deviceId) => {
    setError('');
    const ok = await setOutputDevice(deviceId === 'default' ? '' : deviceId);
    if (!ok) setError('Music could not switch to that output. Play something first, then try again.');
  };

  const shown = player.muted ? 0 : player.volume;
  return (
    <ViewShell title="Sound" onBack={onBack}>
      <div className="cc-slider-row cc-view-slider">
        <button type="button" className="cc-slider-icon cc-slider-btn" aria-label={player.muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>
          {shown === 0 ? <SpeakerMutedIcon size={17} /> : <SpeakerIcon size={17} level={1} />}
        </button>
        <input
          type="range"
          className="cc-slider"
          min={0}
          max={100}
          value={shown}
          aria-label="Music volume"
          style={{ '--cc-fill': `${shown}%` }}
          onChange={(e) => {
            if (player.muted) toggleMute();
            setPlayerVolume(Number(e.target.value));
          }}
        />
        <span className="cc-slider-icon"><SpeakerIcon size={19} level={3} /></span>
      </div>
      <h3 className="cc-view-subtitle">Output</h3>
      {!supported && <p className="cc-note">This browser can't choose where music plays; it uses the system's output.</p>}
      {supported && (
        <ul className="cc-list" role="listbox" aria-label="Sound output">
          {(outputs.length ? outputs : [{ deviceId: 'default', label: '' }]).map((d, i) => {
            const id = d.deviceId || 'default';
            const active = id === selected;
            return (
              <li key={id + i}>
                <button type="button" role="option" aria-selected={active} className={`cc-list-item${active ? ' is-active' : ''}`} onClick={() => choose(id)}>
                  <span className="cc-list-icon"><AudioOutputIcon size={15} /></span>
                  <span className="cc-list-label">{d.label || (id === 'default' ? 'System Default' : `Output ${i + 1}`)}</span>
                  {active && <CheckIcon size={13} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {supported && outputs.length > 0 && !named && (
        <button type="button" className="cc-text-btn" onClick={showNames}>Show Device Names…</button>
      )}
      {error && <p className="cc-note cc-note-warn">{error}</p>}
      <p className="cc-note">Sets iWeb Music's volume and output; the system volume stays as it is.</p>
    </ViewShell>
  );
}

// ---- Calculator ---------------------------------------------------------------------------

const KEYS = [
  ['clear', '±', '%', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['0', '.', '='],
];

const actionFor = (key) => {
  if (/^[0-9]$/.test(key)) return { type: 'digit', digit: key };
  return { clear: { type: 'clear' }, '±': { type: 'sign' }, '%': { type: 'percent' }, '.': { type: 'dot' }, '=': { type: 'equals' } }[key]
    || { type: 'op', op: key };
};

function CalculatorView({ onBack }) {
  const [calc, dispatch] = useReducer(calculate, initialCalc);
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const action = actionForKey(e.key);
      if (!action) return;
      e.preventDefault();
      dispatch(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const size = calc.display.length > 9 ? ' is-small' : '';
  return (
    <ViewShell title="Calculator" onBack={onBack} className="cc-calc">
      <output className={`cc-calc-display${size}`} aria-live="polite">{calc.display}</output>
      <div className="cc-calc-keys">
        {KEYS.flat().map((key) => {
          const isOp = ['÷', '×', '−', '+', '='].includes(key);
          const isFn = ['clear', '±', '%'].includes(key);
          const active = isOp && key !== '=' && calc.op === key && calc.fresh;
          return (
            <button
              key={key}
              type="button"
              className={`cc-calc-key${isOp ? ' is-op' : ''}${isFn ? ' is-fn' : ''}${key === '0' ? ' is-zero' : ''}${active ? ' is-active' : ''}`}
              onClick={() => dispatch(actionFor(key))}
            >
              {key === 'clear' ? clearLabel(calc) : key}
            </button>
          );
        })}
      </div>
    </ViewShell>
  );
}

// ---- Timer --------------------------------------------------------------------------------

function TimerView({ onBack }) {
  const timer = useTimer();
  const now = useTicker(isRunning(timer), 250);
  const [minutes, setMinutes] = useState(5);
  const active = isActive(timer);
  const left = remainingAt(timer, now);
  const progress = active ? left / timer.duration : 0;
  const R = 52;
  const C = 2 * Math.PI * R;
  return (
    <ViewShell title="Timer" onBack={onBack} className="cc-timer">
      {active ? (
        <>
          <div className="cc-timer-face">
            <svg viewBox="0 0 120 120" width="150" height="150" aria-hidden="true">
              <circle cx="60" cy="60" r={R} className="cc-timer-track" />
              <circle cx="60" cy="60" r={R} className="cc-timer-ring" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} />
            </svg>
            <span className="cc-timer-left" role="timer">{timer.done ? 'Done' : formatRemaining(left)}</span>
          </div>
          <div className="cc-timer-actions">
            <button type="button" className="cc-text-btn" onClick={cancelTimer}>{timer.done ? 'Dismiss' : 'Cancel'}</button>
            {!timer.done && (
              <button type="button" className="cc-text-btn is-primary" onClick={() => (isRunning(timer) ? pauseTimer() : resumeTimer())}>
                {isRunning(timer) ? 'Pause' : 'Resume'}
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="cc-timer-presets">
            {PRESETS_MIN.map((m) => (
              <button key={m} type="button" className="cc-chip" onClick={() => startTimer(m * 60_000)}>
                {m < 60 ? `${m} min` : '1 hr'}
              </button>
            ))}
          </div>
          <form
            className="cc-timer-custom"
            onSubmit={(e) => {
              e.preventDefault();
              startTimer(minutes * 60_000);
            }}
          >
            <label htmlFor="cc-timer-minutes">Minutes</label>
            <input
              id="cc-timer-minutes"
              type="number"
              min={1}
              max={MAX_MINUTES}
              value={minutes}
              onChange={(e) => setMinutes(Math.min(MAX_MINUTES, Math.max(1, Number(e.target.value) || 1)))}
            />
            <button type="submit" className="cc-text-btn is-primary">Start</button>
          </form>
          <p className="cc-note">The countdown shows beside the Dynamic Island and chimes when it ends.</p>
        </>
      )}
    </ViewShell>
  );
}

export default function ControlView({ view, onBack }) {
  switch (view) {
    case 'connection': return <ConnectionView onBack={onBack} />;
    case 'sound': return <SoundView onBack={onBack} />;
    case 'calculator': return <CalculatorView onBack={onBack} />;
    case 'timer': return <TimerView onBack={onBack} />;
    default: return null;
  }
}
