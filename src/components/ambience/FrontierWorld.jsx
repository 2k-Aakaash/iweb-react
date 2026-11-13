import FrontierScenery from './FrontierScenery';
import WeatherIcon from './WeatherIcon';
import { LOCATIONS, REGIONS, WORLD, locationById, locationsIn } from '../../libs/ambience/frontier/catalogue.js';
import { effectiveConditions, timeLabel, weatherLabel } from '../../libs/ambience/frontier/conditions.js';
import { getAmbience, openFrontier } from '../../libs/ambience/store.js';
import '../../styles/frontier.css';

// Frontier World in the Atmosphere window: the way into its own window (FrontierWindow.jsx),
// where the places, the hour, the weather and the music are chosen. Here: what's playing or
// was last visited, a way to listen to it at once, and the five destinations.

export default function FrontierWorld({ state }) {
  const engine = getAmbience();
  const place = locationById(state.environmentId) || locationById(state.frontier.locationId) || LOCATIONS[0];
  const here = state.environmentId === place.id;
  const playing = here && state.status === 'playing';
  const cond = here && state.conditions ? state.conditions : effectiveConditions(place, state.frontier);
  return (
    <div className="fr">
      <section className="fr-hero" aria-label={WORLD.name}>
        <FrontierScenery regionId={place.regionId} locationId={place.id} time={cond.time} weather={cond.weather} />
        <div className="fr-hero-text" data-force-dark>
          <span className="fr-hero-kicker">Frontier World</span>
          <h3 className="fr-hero-title">{WORLD.name}</h3>
          <p className="fr-hero-desc">{WORLD.description}</p>
          <div className="fr-hero-actions">
            <button type="button" className="atm-btn is-primary" onClick={() => openFrontier()}>Open Frontier World</button>
            {!playing && (
              <button type="button" className="atm-btn" onClick={() => engine.openLocation(place.id, { play: true })}>
                {here ? `Resume ${place.name}` : `Listen to ${place.name}`}
              </button>
            )}
            <span className="fr-chip">
              <WeatherIcon weather={cond.weather} night={cond.time === 'night'} /> {playing ? 'Playing' : here ? 'Paused' : 'Last visited'}: {place.name} · {timeLabel(cond.time)}, {weatherLabel(cond.weather).toLowerCase()}
            </span>
          </div>
        </div>
      </section>
      <section className="atm-section" aria-label="Destinations">
        <h3>Destinations</h3>
        <div className="fr-regions">
          {REGIONS.map((r) => {
            const sample = locationsIn(r.id)[0];
            return (
              <button key={r.id} type="button" className={`fr-region${place.regionId === r.id && here ? ' is-active' : ''}`} onClick={() => openFrontier()} style={{ '--fr-accent': r.accent }} title={`Open Frontier World: ${r.name}`}>
                <FrontierScenery regionId={r.id} locationId={sample.id} time={sample.time} weather="clear" className="fr-card-art" />
                <span className="fr-card-text">
                  <span className="fr-card-name">{r.name}</span>
                  <span className="fr-card-desc">{r.description}</span>
                  <span className="fr-card-meta">{locationsIn(r.id).map((l) => l.name).join(' · ')}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
