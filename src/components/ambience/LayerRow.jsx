import MacSlider from '../ui/MacSlider';
import { getAmbience } from '../../libs/ambience/store.js';

// A layer's mix row: mute, its name (and a note), its level and value. Used by Atmosphere's
// Customize tab and the Frontier World window; every control calls the engine.

const speaker = <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
const mutedIcon = <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;

export default function LayerRow({ layer, value, muted, note }) {
  const engine = getAmbience();
  const v = Math.round(value * 100);
  return (
    <div className={`atm-slider-row atm-layer-row${muted ? ' is-muted' : ''}`}>
      <button
        type="button"
        className="atm-mute"
        aria-pressed={muted}
        aria-label={muted ? `Unmute ${layer.label}` : `Mute ${layer.label}`}
        title={muted ? 'Unmute' : 'Mute'}
        onClick={() => engine.setLayerMuted(layer.id, !muted)}
      >
        {muted ? mutedIcon : speaker}
      </button>
      <span className="atm-slider-label">
        {layer.label}
        {note && <span className="atm-layer-note">{note}</span>}
      </span>
      <MacSlider aria-label={layer.label} aria-valuetext={muted ? `${v}%, muted` : `${v}%`} min={0} max={100} value={v} onChange={(x) => engine.setLayerVolume(layer.id, x / 100)} />
      <span className="atm-value">{muted ? 'Off' : v}</span>
    </div>
  );
}
