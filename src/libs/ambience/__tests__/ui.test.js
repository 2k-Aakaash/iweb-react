// What the island and the window show, rendered to markup (Vitest runs in Node: no DOM, so
// the components are server-rendered from the same engine state the page uses). Interaction
// was checked in the browser; this pins down what's on screen for each state.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AmbienceIsland from '../../../components/ambience/AmbienceIsland.jsx';
import AtmosphereWindow from '../../../components/ambience/AtmosphereWindow.jsx';
import { _resetAmbience, getAmbience } from '../store.js';

// The glass needs a real page (it measures the backdrop); it's decoration here.
vi.mock('../../../components/glass/GlassSurface.jsx', () => ({ default: () => null }));

const island = (state, expanded = true) => renderToStaticMarkup(createElement(AmbienceIsland, { state, expanded }));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

beforeEach(() => {
  vi.useFakeTimers();
  // The little of `window` the window's hooks read while rendering.
  vi.stubGlobal('window', {
    innerWidth: 1440, innerHeight: 900,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  });
  _resetAmbience();
});

afterEach(() => {
  _resetAmbience();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('The Dynamic Island', () => {
  it('shows the environment honestly: a labelled volume and a level, never a track position', () => {
    const state = { ...getAmbience().getState(), status: 'playing', session: true };
    const html = island(state);
    expect(html).toContain('aria-label="Atmosphere volume"');
    expect(html).toContain('aria-valuetext="60%"');
    expect(text(html)).toContain('Rainy Mood');
    expect(text(html)).toContain('Atmosphere · Live');
    // No music-style progress row, elapsed / remaining times or a fake title.
    expect(html).not.toMatch(/expanded-progress-row|expanded-time|progress/);
    expect(text(html)).not.toMatch(/\d+:\d\d/);
    expect(html).toContain('aria-label="Evolution: Gentle. Change to Dynamic"');
    for (const label of ['Stop', 'Pause', 'Next environment', 'Open Atmosphere', 'Shuffle: a new arrangement']) {
      expect(html).toContain(`aria-label="${label}"`);
    }
  });

  it('names the scene with its environment, and says when it’s paused', () => {
    const state = { ...getAmbience().getState(), status: 'paused', session: true, sceneId: 'deep-focus', environmentId: 'deep-space' };
    const t = text(island(state));
    expect(t).toContain('Deep Focus');
    expect(t).toContain('Deep Space · Paused');
    expect(island(state)).toContain('aria-label="Play"');
  });

  it('shows a focus session’s time left, and only that', () => {
    const now = Date.now();
    const state = {
      ...getAmbience().getState(), status: 'playing', session: true,
      focus: { status: 'running', totalMs: 25 * 60000, remainingMs: 25 * 60000, endsAt: now + 24 * 60000 + 1000 },
    };
    const collapsed = text(island(state, false));
    expect(collapsed).toMatch(/25 min/);
    expect(text(island(state))).toMatch(/Focus · 25 min left/);
  });

  it('uses real level bars, live only while playing with Sound visuals on', () => {
    const base = getAmbience().getState();
    expect(island({ ...base, status: 'playing', session: true })).toContain('atm-levels is-live');
    expect(island({ ...base, status: 'playing', session: true, visualizer: false })).not.toContain('atm-levels is-live');
    expect(island({ ...base, status: 'paused', session: true })).not.toContain('atm-levels is-live');
  });
});

describe('The Atmosphere window', () => {
  const render = (tab) => renderToStaticMarkup(createElement(AtmosphereWindow, { open: true, setOpen: () => {}, tab }));

  it('opens on Explore: scenes with favourites, then environments', () => {
    const html = render('explore');
    const t = text(html);
    for (const name of ['Deep Focus', 'Midnight Coding', 'Rainy Reading', 'Forest Escape', 'Ocean Meditation', 'Late Night']) expect(t).toContain(name);
    for (const name of ['Rainy Mood', 'Deep Space', 'Forest', 'Ocean', 'Fireplace', 'Dreamscape']) expect(t).toContain(name);
    expect(html).toContain('aria-label="Add Deep Focus to Favorites"');
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/aria-selected="true"[^>]*>Explore/);
  });

  it('puts the mix, character, evolution and stereo in Customize', () => {
    const t = text(render('customize'));
    for (const s of ['Mix · Rainy Mood', 'Rain', 'Thunder', 'Character', 'Evolution', 'Off', 'Gentle', 'Dynamic', 'Organic', 'Stereo', 'Width', 'Movement', 'Save as a Scene']) {
      expect(t).toContain(s);
    }
  });

  it('puts focus, the sleep timer, visual effects and suggestions in Experience', () => {
    const t = text(render('experience'));
    for (const s of ['Focus session', '25m', '45m', '60m', '90m', 'Custom', 'Sleep timer', 'Edge glow', 'Sound visuals', 'Match the wallpaper', 'Suggest by time of day']) {
      expect(t).toContain(s);
    }
  });

  it('reflects the engine: a scene applied elsewhere is what the window shows', async () => {
    await getAmbience().applyScene('ocean-meditation');
    const t = text(render('customize'));
    expect(t).toContain('Mix · Ocean');
    expect(t).toContain('Waves');
  });
});
