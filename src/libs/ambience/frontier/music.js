// Frontier music: original instrumental music, generated live and never the same twice:
// fingerpicked guitar-like plucks over a soft bowed pad, in six moods. Nothing is recorded
// and nothing is borrowed: the patterns are common folk accompaniment figures (alternating
// bass, waltz time, open fifths) played with chord progressions written for iWeb, and the
// melody notes are chosen as it plays.
//
// It sits under the ambience: off by default, with its own volume, and a mood that follows
// the hour and the weather (Auto) or is chosen. A change of mood waits for the end of the
// phrase, and the pad's long release carries one into the next.
//
// Frontier Radio plays the same moods as songs rather than accompaniment: a lead melody over
// the pattern, phrases in an A A′ B A shape (the last A brings back the first A's melody, the B
// section moves to other chords), a fuller pad and hardly any rests. Still generated as it
// plays and original; a licensed track could later take its place (assets.js: 'original-music').
import { glide } from '../voices.js';
import { melodicNote, mtof, range, scaleNotes, SCALES } from '../random.js';

const B = (bass, upper) => ({ bass, upper });

export const MOODS = Object.freeze({
  'frontier-calm': {
    label: 'Frontier Calm',
    hint: 'Unhurried fingerpicking in a major key.',
    bpm: 68, beats: 4, style: 'travis', pad: 0.022, root: 50, scale: SCALES.majorPentatonic,
    chords: [B([38, 45], [50, 54, 57, 62]), B([38, 43], [50, 55, 59, 62]), B([45, 40], [52, 57, 61, 64]), B([38, 45], [50, 55, 57, 62])],
  },
  'long-ride': {
    label: 'Long Ride',
    hint: 'A steady, travelling rhythm in a minor key.',
    bpm: 80, beats: 4, style: 'gallop', pad: 0.018, root: 57, scale: SCALES.minorPentatonic,
    chords: [B([45, 40], [52, 57, 60, 64]), B([43, 38], [50, 55, 59, 62]), B([41, 48], [53, 57, 60, 65]), B([40, 47], [52, 56, 59, 64])],
  },
  campfire: {
    label: 'Campfire',
    hint: 'A slow waltz, warm and close.',
    bpm: 90, beats: 3, style: 'waltz', pad: 0.02, root: 55, scale: SCALES.majorPentatonic,
    chords: [B([43, 50], [55, 59, 62]), B([48, 43], [55, 60, 64]), B([50, 45], [54, 57, 62]), B([43, 50], [55, 59, 62])],
  },
  wilderness: {
    label: 'Wilderness',
    hint: 'Open fifths and space: a few notes, a long way apart.',
    bpm: 56, beats: 4, style: 'sparse', pad: 0.026, root: 52, scale: SCALES.minorPentatonic,
    chords: [B([40, 47], [52, 59, 64]), B([38, 45], [50, 57, 62]), B([36, 43], [48, 55, 60]), B([40, 47], [52, 59, 64])],
  },
  storm: {
    label: 'Storm Approaching',
    hint: 'Low, uneasy and slow.',
    bpm: 60, beats: 4, style: 'storm', pad: 0.03, root: 50, scale: SCALES.aeolian,
    chords: [B([38, 45], [50, 53, 57]), B([46, 41], [50, 53, 58]), B([38, 45], [50, 53, 57]), B([45, 40], [49, 52, 57])],
  },
  'night-watch': {
    label: 'Night Watch',
    hint: 'Quiet bell-like harmonics over a low drone.',
    bpm: 52, beats: 4, style: 'harmonics', pad: 0.022, root: 64, scale: SCALES.minorPentatonic,
    chords: [B([40, 47], [64, 67, 71]), B([48, 43], [64, 67, 72]), B([45, 40], [64, 69, 72]), B([47, 42], [63, 66, 71])],
  },
});

export const MOOD_IDS = Object.keys(MOODS);
export const validMood = (id) => (id === 'auto' || MOOD_IDS.includes(id) ? id : 'auto');

/** The mood that suits a place, an hour and a weather (Auto). */
export function autoMood(location, cond) {
  if (!location || !cond) return 'frontier-calm';
  if (cond.weather === 'thunderstorm' || cond.weather === 'heavy-rain') return 'storm';
  if (cond.time === 'night') return 'night-watch';
  if (cond.weather === 'snowfall' || cond.time === 'dawn') return 'wilderness';
  const kinds = location.layers.map((l) => l.kind);
  if (cond.time === 'dusk') return kinds.includes('fire') || kinds.includes('distant') ? 'campfire' : 'wilderness';
  return location.regionId === 'plains' || location.regionId === 'desert' ? 'long-ride' : 'frontier-calm';
}

/**
 * One bar's notes: [{ at (beats), midi, kind: 'pluck' | 'bass' | 'bell', level, lead? }].
 * `lead` (Frontier Radio) adds a singing melody line on most beats.
 */
export function barNotes(mood, chord, rng, prevMelody = null, { lead = false } = {}) {
  const out = [];
  const r = (a, b) => range(rng, a, b);
  const up = chord.upper;
  const melodyNotes = scaleNotes(mood.root, mood.scale, up[0] + 5, up[up.length - 1] + 7);
  let melody = prevMelody;
  const melodic = (at, level) => {
    melody = melodicNote(rng, melodyNotes, melody);
    if (melody !== null) out.push({ at, midi: melody, kind: 'pluck', level });
  };
  switch (mood.style) {
    case 'travis': {
      const fingers = [up[2], up[3] ?? up[2], up[1], up[3] ?? up[2]];
      for (let i = 0; i < 8; i += 1) {
        if (i % 2 === 0) out.push({ at: i / 2, midi: chord.bass[(i / 2) % 2], kind: 'bass', level: 0.9 });
        else if (rng() > 0.15) {
          if (rng() < 0.2) melodic(i / 2, 0.75);
          else out.push({ at: i / 2, midi: fingers[(i - 1) / 2], kind: 'pluck', level: 0.6 });
        }
      }
      break;
    }
    case 'gallop': {
      for (let b = 0; b < 4; b += 1) {
        out.push({ at: b, midi: chord.bass[b % 2], kind: 'bass', level: b % 2 ? 0.7 : 0.9 });
        if (b % 2 === 1) up.slice(1).forEach((m, i) => out.push({ at: b + 0.5 + i * 0.015, midi: m, kind: 'pluck', level: 0.45 }));
        else if (rng() < 0.35) melodic(b + 0.5, 0.6);
      }
      break;
    }
    case 'waltz': {
      out.push({ at: 0, midi: chord.bass[0], kind: 'bass', level: 0.95 });
      for (const beat of [1, 2]) {
        up.forEach((m, i) => out.push({ at: beat + i * 0.02, midi: m, kind: 'pluck', level: 0.4 }));
      }
      if (rng() < 0.5) melodic(r(0, 1) < 0.5 ? 1.5 : 2.5, 0.65);
      break;
    }
    case 'sparse': {
      if (rng() < 0.85) out.push({ at: 0, midi: chord.bass[0], kind: 'bass', level: 0.85 });
      const n = Math.round(r(1, 3));
      for (let i = 0; i < n; i += 1) {
        const at = Math.floor(r(1, 8)) / 2;
        if (rng() < 0.5) melodic(at, 0.7);
        else out.push({ at, midi: up[Math.floor(rng() * up.length)], kind: 'pluck', level: 0.55 });
      }
      break;
    }
    case 'storm': {
      out.push({ at: 0, midi: chord.bass[0], kind: 'bass', level: 1 });
      out.push({ at: 2.5, midi: chord.bass[0], kind: 'bass', level: 0.7 });
      if (rng() < 0.4) out.push({ at: r(1, 3.5), midi: up[0] + 1, kind: 'bell', level: 0.5 }); // a minor second: unease
      break;
    }
    default: { // harmonics
      if (rng() < 0.6) out.push({ at: 0, midi: chord.bass[0], kind: 'bass', level: 0.6 });
      const n = Math.round(r(1, 3));
      for (let i = 0; i < n; i += 1) out.push({ at: Math.floor(r(0, 8)) / 2, midi: up[Math.floor(rng() * up.length)], kind: 'bell', level: 0.7 });
    }
  }
  if (lead) {
    // A melody that moves in small steps, on the beat and sometimes between.
    const leadNotes = scaleNotes(mood.root + 12, mood.scale, up[0] + 7, up[up.length - 1] + 14);
    for (let b = 0; b < mood.beats; b += 1) {
      if (rng() < 0.72) {
        melody = melodicNote(rng, leadNotes, melody);
        if (melody !== null) out.push({ at: b + (rng() < 0.25 ? 0.5 : 0), midi: melody, kind: mood.style === 'harmonics' ? 'bell' : 'pluck', level: 0.85, lead: true });
      }
    }
  }
  return { notes: out.sort((a, b) => a.at - b.at), melody };
}

const SONG = ['A', 'A2', 'B', 'A'];

/**
 * The music for one location's instance: its own layer (never part of the mix sliders or
 * evolution), scheduled on the audio clock a bar at a time while it's on.
 */
export function createMusic(kit) {
  const { ctx, rng } = kit;
  const layer = kit.layer(0, { reverb: 0.45, delay: 0.1 });
  // One place for the music (no panner per note: lighter, and a band sits together).
  kit.configureLayer(layer.gain, { pos: 0, drift: 0.15 });
  const dest = layer.gain;
  let enabled = false;
  let moodId = 'frontier-calm';
  let pending = null;
  let barAt = 0; // when the next bar starts (audio clock); 0: not started
  let bar = 0; // bar within the phrase
  let restBars = 0;
  let tempo = 1;
  let melody = null;
  let radio = false;
  let section = -1; // Frontier Radio: where in the A A′ B A song
  let remembered = []; // the first A's lead, bar by bar, for the last A

  const play = (at, n, mood, beat) => {
    const t = at + n.at * beat + range(rng, -0.012, 0.012);
    const f = mtof(n.midi);
    if (n.kind === 'bell') {
      kit.tone(t, f, { dest, level: 0.03 * n.level, decay: 4, kind: 'bell', bright: 2600 });
      return;
    }
    // Radio's inner notes ring shorter: the lead carries the line, and fewer voices overlap.
    const decay = n.kind === 'bass' ? (radio ? 2.2 : 2.8) : radio && !n.lead ? 1.3 : 2;
    kit.pluck(t, f, { dest, level: (n.kind === 'bass' ? 0.07 : 0.05) * n.level * range(rng, 0.85, 1.1), decay, bright: n.kind === 'bass' ? 1400 : 3000 });
  };

  return {
    layer,
    /** { enabled, volume (0–1), mood (a resolved mood id), radio }; `tc` is the fade. */
    set({ enabled: on, volume, mood, radio: asRadio = false }, tc = 1.5) {
      if (MOODS[mood] && mood !== moodId) pending = mood;
      if (on && !enabled) barAt = 0; // starts afresh at the next window
      if (Boolean(asRadio) !== radio) {
        radio = Boolean(asRadio);
        section = -1;
      }
      enabled = Boolean(on);
      // Radio leads: about 5 dB above the music that sits under the ambience.
      glide(layer.gain.gain, enabled ? Math.max(0, Math.min(1, volume)) ** 2 * 0.9 * (radio ? 1.8 : 1) : 0, ctx, tc);
    },
    schedule(from, to) {
      if (!enabled) return;
      if (!barAt || barAt < from - 1) {
        barAt = from + 0.4;
        bar = 0;
        restBars = 0;
      }
      let guard = 0;
      while (barAt < to && guard < 4) {
        guard += 1;
        if (bar === 0 && pending) {
          moodId = pending;
          pending = null;
        }
        const mood = MOODS[moodId];
        const beat = 60 / (mood.bpm * tempo);
        const length = beat * mood.beats;
        if (restBars > 0) {
          restBars -= 1;
          barAt += length;
          continue;
        }
        if (bar === 0 && radio) section = (section + 1) % SONG.length;
        const part = radio ? SONG[section] : null;
        // The B section moves to the other half of the progression.
        const chord = mood.chords[(bar + (part === 'B' ? 2 : 0)) % mood.chords.length];
        if (bar === 0) {
          tempo = radio && part !== 'A' ? tempo : range(rng, 0.96, 1.04);
          const phrase = length * mood.chords.length;
          kit.pad(barAt, [mtof(chord.bass[0] + 12), mtof(chord.upper[0]), mtof(chord.upper[1])], {
            dest, level: mood.pad * (radio ? 1.35 : 1), attack: radio ? 2 : 3, hold: Math.max(1, phrase - 3), release: 6, cutoff: radio ? 1200 : 900,
          });
        }
        const made = barNotes(mood, chord, rng, melody, { lead: radio });
        melody = made.melody;
        let notes = made.notes;
        if (radio && section === 0) remembered[bar] = notes.filter((n) => n.lead);
        if (radio && section === 3 && remembered[bar]) notes = [...notes.filter((n) => !n.lead), ...remembered[bar]];
        for (const n of notes) play(barAt, n, mood, beat);
        barAt += length;
        bar += 1;
        if (bar >= mood.chords.length) {
          bar = 0;
          if (radio) {
            // A breath only between songs.
            restBars = section === SONG.length - 1 ? 1 : 0;
            if (section === SONG.length - 1) remembered = [];
          } else {
            // A breath between phrases, longer in the slow moods.
            restBars = rng() < 0.6 ? Math.round(range(rng, 1, mood.style === 'sparse' || mood.style === 'harmonics' ? 3 : 2)) : 0;
          }
        }
      }
    },
    mood: () => pending || moodId,
    enabled: () => enabled,
    radio: () => radio,
    /** Frontier Radio's place in the song ('A', 'A2', 'B'), or null. */
    section: () => (radio && section >= 0 ? SONG[section] : null),
  };
}
