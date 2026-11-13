# Atmosphere: living soundscapes

Atmosphere generates continuous ambient sound in the browser with the Web Audio API. There are no recordings, no streaming and no downloads.

Its soundscapes evolve slowly while they play, and come as ready-made Scenes. Each one sits in a stereo field. **Frontier World** adds an original landscape to explore by ear: five regions, 25 places, each with its own hour, weather, wildlife and generated music. The Atmosphere window is the main control surface and the Dynamic Island is the quick one. While it plays, a soft light runs along the edges of the screen.

## Where things are

| Part | Files |
| --- | --- |
| Engine (no React) | `src/libs/ambience/engine.js` |
| Living Atmosphere (evolution) | `src/libs/ambience/evolution.js` |
| Scenes | `src/libs/ambience/scenes.js` |
| Synthesis kit (layers, stereo, noise, tones, pads, bursts, chirps) | `src/libs/ambience/voices.js` |
| Seeded randomness and scales | `src/libs/ambience/random.js` |
| Environments | `src/libs/ambience/environments/` |
| Frontier World: catalogue, time and weather, world clock, sound library, events, music, environments, reserved recordings | `src/libs/ambience/frontier/` (`catalogue.js`, `conditions.js`, `world.js`, `sounds.js`, `events.js`, `music.js`, `environments.js`, `assets.js`) |
| Frontier World's window, its way in and its artwork | `FrontierWindow.jsx`, `FrontierWorld.jsx`, `FrontierScenery.jsx` in `src/components/ambience/`, `src/styles/frontier.css` ([FRONTIER_WORLD.md](FRONTIER_WORLD.md)) |
| Saved settings and scenes (iWebDB, in backups) | `src/libs/ambience/prefs.js` |
| The page's engine, the shared meter, hooks | `src/libs/ambience/store.js` |
| Wallpaper and time-of-day suggestions | `src/libs/ambience/suggestions.js`, `src/components/ambience/AtmosphereServices.jsx` |
| Window (Explore, Frontier (the way in), Customize, Experience) | `src/components/ambience/AtmosphereWindow.jsx`, `src/styles/atmosphere.css` |
| Island content, level bars, focus time | `AmbienceIsland.jsx`, `LevelBars.jsx`, `FocusTime.jsx` in `src/components/ambience/`, `src/styles/ambience-island.css` |
| Edge glow | `src/components/ambience/AmbienceGlow.jsx`, `src/styles/ambience-glow.css` |
| Tests | `src/libs/ambience/__tests__/` (a small fake Web Audio API; the UI is server-rendered) |

## Engine

- **One engine per tab.** It owns the only `AudioContext` and is the single source of truth. The window, the island and the glow all read it through `useAmbience()`.
- **Graph:** each layer runs through three stages:
  - level (the mix slider);
  - evolution gain;
  - stereo panner.

  From there it goes to the environment output, then master, sleep fade, focus fade, limiter and the output. One shared reverb (a 2-second generated impulse) and one shared delay serve everything.
- **Lazy.** Nothing is created on page load. The context is made on the first Play (a user gesture) at 48 kHz and reused.
- **Pause** fades out and suspends the context. **Stop** also disposes the environment's nodes.
- **Switching** environment, or applying a scene in another environment, crossfades over about 2.5 seconds. The old environment is then disposed, and at most two fade at once.
- **Scheduling.** Events are scheduled on the audio clock by a 250 ms ticker that runs only while playing. Its window is 0.9 s while the tab is visible and 3.5 s while it's hidden. Evolution steps ride the same ticker.
- **Smooth.** Every gain and parameter change is a ramp. Noise buffers are made once per context.
- **One tab at a time** (`BroadcastChannel`).
- **Honest state.** A blocked start or a browser suspension is reported as such.

## Living Atmosphere (evolution)

Evolution has four modes:

| Mode | First step | Between steps | Ramps |
| --- | --- | --- | --- |
| **Off** | – | – | – |
| **Gentle** | 45–90 s | 100–190 s | time constant 22–38 s |
| **Dynamic** | 25–45 s | 45–90 s | time constant 9–16 s |
| **Organic** | 20–70 s | 25–160 s | Layers may rest or bloom; some are left alone |

A step does three things:

1. It moves each layer's **evolution gain** within the environment's range, so the user's mix level is never touched.
2. It nudges Mood, Variation and Depth by a small amount around the user's values, in two-second moves.
3. Sometimes it asks the environment for a **harmonic change**:
   - Deep Space: a new progression, or the neighbouring mode on the same root;
   - Dreamscape: a closely related key;
   - Rainy Mood: the piano's register;
   - Forest: different birds;
   - Ocean: the swell's rhythm;
   - Fireplace: how the fire burns.

Each environment defines its profile, with a range per layer and a starting value. Dreamscape, for example, opens on pads and the piano arrives over the first minutes. Rain stays the foundation of Rainy Mood. The drone holds in Deep Space.

Guarantees:
- **Volume:** the master volume and the mix levels are never changed, and the evolved mix is never more than about 0.7 dB louder overall (a loudness guard).
- **Timing:** one step at most per tick, and none while paused or stopped. Hidden or suspended tabs build no backlog.
- **Shuffle:** a shuffle restarts the sequence from a new seed and defers the next step, so the two don't collide.

## Scenes

A scene is a tuned starting point: an environment with its layers, Mood, Variation and Depth, Evolution, and the stereo Width and Movement. It's a versioned record (`version: 2`), validated on read, and never contains audio.

**Built in:** Deep Focus, Midnight Coding, Rainy Reading, Forest Escape, Ocean Meditation, Late Night and Fireside. Fireside was added so Fireplace has a scene too.

- **Applying** a scene in the same environment glides every layer there (about 4 seconds); in another environment, it crossfades.
  - The master volume and the `AudioContext` are left as they are.
  - From the window, the card plays the scene. A suggestion applies and plays it. Applied while stopped, it doesn't play.
- **Your Scenes:** save the current sound under a name, then apply, rename or delete it. Scenes and favourites can be starred; favourites appear first in Explore.
- Atmosphere 1's presets are read as scenes with Gentle evolution. Their saved volume is no longer applied.

## Stereo

This is a stereo image, not 3D audio. Each layer has one `StereoPannerNode`:

- **Width** scales where each layer sits.
- **Movement** sets how fast and how far drifting layers move, using one slow LFO per drifting layer. The drift is limited so a layer never reaches the edge.
- **Events** (raindrops, crackles, birds, bells) spread across the field, with one small panner each, only when there's width. A pad's detuned pairs are split left and right.

Width 0 is centred and still. Mono playback stays acceptable: the sources are mono, there are no delays between the channels, and the equal-power pan costs at most about 3 dB at the extremes.

## The Dynamic Island

The island's container, states, transitions and click-outside are unchanged. Atmosphere supplies the content, in the island's own classes. It shows while Atmosphere has a session, unless a song is playing.

- **Collapsed:** the orb (plays or pauses), the scene or environment name, and real level bars. During a focus session, the bars give way to the time left ("24 min").
- **Hovered:** the name, and "Rainy Mood · Live" or "Focus · 24 min left".
- **Expanded:**
  - the orb, which opens the window;
  - the name and status;
  - an **Evolution** chip (shows the mode; a click moves to the next);
  - a **labelled volume** with its value and the live level;
  - Stop, Shuffle, Play/Pause, Next environment, and Open Atmosphere.
- **Honest:** there's no title, duration or progress bar, because generated ambience has none. The volume has a visible thumb and a percentage; the bars are the actual output.
- **Accent:** each environment has a low-saturation accent (Rainy Mood cool blue, Deep Space violet, Forest muted green, Ocean teal, Fireplace amber, Dreamscape lavender). It colours the island's rim and bars and cross-fades when the environment changes; the colours are registered CSS properties.

## The window

The transport (play, stop, shuffle, volume, live level) is always visible. Below it are three tabs:

- **Explore:** the time-of-day suggestion (when on), Favorites, Scenes, Your Scenes and Environments.
- **Customize:** Mix, Character, Evolution, Stereo, and Save as a Scene.
- **Experience:** Focus session and Sleep timer, Visual Effects (Edge glow, Glow follows the sound, Sound visuals), and Suggestions (Match the wallpaper, the current wallpaper's linked scene, Suggest by time of day).

While playing, with Sound visuals on, the window's header shows a little scenery for the environment: stars, a swell of light, floating lights, specks of dust, faint rain or rising embers. It's two CSS layers using transform and opacity, and it only exists while the window is open.

## The edge glow and the meter

- **The glow:** one fixed element that takes no pointer events and affects no layout, masked to a band about 30 px wide.
  - Two conic gradients turn slowly in the environment's three glow colours, which cross-fade when the environment changes.
  - It's mounted only while playing, plus its fade-out.
- **The meter:** one shared sampler (`store.js`) reads an `AnalyserNode` about 10 times a second.
  - It runs only while something listens, Atmosphere is playing, the page is visible and motion isn't reduced. Otherwise it stops, and the analyser leaves the graph.
  - It gives an overall level (for the glow) and five bands (for the bars). Each band is lifted by a fixed tilt, measured across the six environments, so the highs register.
  - Listeners write CSS variables only when a value visibly changes, so nothing re-renders.
- **When it's off:** with Sound visuals off or reduced motion, the bars rest and the scenery is still.

## Focus sessions

- **Lengths:** 25, 45, 60 or 90 minutes, or Custom (5–240). Starting a session plays the current sound.
- **Pausing:** the session runs while the sound plays; pausing (from anywhere) pauses its clock.
- **The end:** near the end it fades out over the last minute, or the last quarter of a short session. Then it stops or pauses, as set under *When it ends*, and posts a notification.
- **+10 min** lifts a fade already under way; **End Session** stops the timer and keeps the sound.
- **Time left** shows in the window, the window header and the island, as text only.
- **After a reload:** the session is restored as paused, with the time that was left (saved when the page closes), and never plays by itself. Sessions older than 12 hours are dropped.
- **Hidden tabs:** the fade runs on the audio clock, so it's on time. The stop that follows can be up to about a minute late, because browsers slow timers in hidden tabs; by then the sound is already silent.

## Suggestions

Suggestions only ever post a notification, using the existing banner and Notification Center. Only a click applies the scene (and plays: the click is a user gesture). Everything is local: no network and no image analysis.

- **Match the wallpaper** (on by default, but only after Atmosphere has been played once):
  - It reacts when the wallpaper changes in this tab.
  - The scene linked to that wallpaper comes first (Experience → Current wallpaper). Links are stored by the wallpaper's own id, `local:12` or `unsplash:abc`.
  - Otherwise it matches a scene from the wallpaper's own words: an Unsplash photo's topic, search and description, or a local file's name.
  - Each wallpaper and scene pair is suggested once.
- **Suggest by time of day** (off by default):
  - Once per morning, afternoon, evening and night, from this device's clock.
  - It's checked when it's switched on, when iWeb comes back into view, and by one timer at the next boundary. There's no polling.
  - Nothing is suggested during a focus session.

## Frontier World

An original frontier landscape to explore by ear, in its own window: five destinations and 25 places. Each has its own hour, weather (simulated or chosen), living-world events and generated music, in three experience modes (Environmental, Cinematic, Frontier Radio). It runs on this engine and store: each place is an environment, so everything above applies to it.

Its full description, from the catalogue to the world clock, sound, events, music, interface, settings and tests, is in **[FRONTIER_WORLD.md](FRONTIER_WORLD.md)**.

## Persistence

Saved in iWebDB, through `storedPref`, so it's in backups. **Settings v4** holds:

- the environment and master volume;
- each environment's layers, muted layers and character (the classic six and the 25 Frontier places);
- the scene;
- evolution and stereo;
- the glow and Sound visuals switches;
- the sleep timer and focus preferences;
- favourites;
- the suggestion switches;
- the wallpaper links;
- Frontier World's own section: the place, experience mode, time and weather and how they move, intensities, ambience and music volumes, and mood (see [FRONTIER_WORLD.md](FRONTIER_WORLD.md#settings)).

**Scenes v2** holds the user's scenes, under the same key as Atmosphere 1's presets. A scene at a Frontier place also keeps its time and weather.

**Migration:** Atmosphere 1, v2 and v3 settings keep every value and gain the new fields with defaults (v3's Frontier fields are converted). Damaged values (an unknown place, time, weather or mood, a level out of range) fall back to defaults. Nothing ever plays after a reload. Three small conveniences live in localStorage:

- the focus session (`iweb:ambienceFocus`);
- the suggestion log;
- the window's last tab.

## Performance (measured)

**Conditions:** Chrome 158, headless, Windows 11, a 1440×900 page, and an audio device running at 192 kHz (the context asks for 48 kHz). Each figure is the renderer process's CPU, which includes the audio thread, averaged over 20 seconds after 2.5 seconds to settle, with the Atmosphere window closed. All rows come from the same run.

| State | CPU (% of one core) | Main-thread style + layout |
| --- | --- | --- |
| Idle, no ambience | 4.0 | 0.7 ms/s |
| Rainy Mood: evolution off, width 0, no glow, no visuals | 10.9 | 0.2 ms/s |
| + Gentle evolution and stereo (width 0.6) | 9.5 | 0.3 ms/s |
| + live level bars on the island | 12.6 | 4.9 ms/s |
| + edge glow following the sound (everything on) | 14.9 | 6.2 ms/s |
| Organic, width 1, movement 1 | 15.3 | 6.4 ms/s |
| Deep Focus scene, everything on | 14.9 | 6.2 ms/s |
| Forest Escape scene, everything on | 14.8 | 6.7 ms/s |
| Paused | 0.4 | 0.1 ms/s |
| Stopped | 0.3 | 0.1 ms/s |

- **Cost of the new features:**
  - Evolution and stereo cost nothing measurable; the difference is within noise.
  - The live bars and the glow's meter together cost about 4% (the 10 Hz analyser read plus restyling a few elements).
  - The glow costs about 2%.
- **Memory:** the JS heap stays at about 11–12 MB throughout.
- **Bounded:** after 70 rapid scene changes, one instance (37 nodes) is left and nothing piles up. The three noise buffers are never remade.
- **Headless:** headless Chrome may composite in software; a real GPU should make the glow and scenery cheaper, but that wasn't measured.
- **Not compared:** the Atmosphere 1 figures were measured in a different session, so these aren't compared with them.

### Frontier World

**Conditions:** a later session on the same machine, which was busier. Each figure is 15 seconds after 3 seconds to settle, with the window closed and everything on (Gentle evolution, stereo, level bars, glow following the sound). The four were measured in turn, four rounds, and averaged.

| State | CPU (% of one core), mean of 4 | Audio nodes |
| --- | --- | --- |
| Rainy Mood (classic), for comparison | 34.2 | 45 |
| Open Prairie, afternoon, clear | 38.9 | 114 |
| Cypress Swamp, night (frogs and insects) | 37.4 | 98 |
| Open Prairie, thunderstorm, with music | 45.4 | 127 |
| Paused / stopped | 0.6–1.1 / 0.6–0.8 | — |

- **Relative cost:** a Frontier place in clear weather costs about 10–15% more CPU than a classic environment; a storm with music about a third more.
- **Lazy beds:** the weather's rain, snow and grit, and the insects' day and night choruses, exist only while their conditions need them, and are freed after they fade. That cut a place in clear weather from about 135 nodes to 98–114.
- **Classic environments unchanged:** in this session Rainy Mood measured 32.4% on the released v3.0 code and 33.6% on this one, side by side, within noise. The figures above are higher than the 2.0 table only because the machine was busier.
- **Memory:** the JS heap stays at about 11–12 MB.
- **Bounded:** after switching through ten places quickly, one instance remains. After Stop: no instances, no nodes, no voices, no ticker.
- **Loudness:** every place was measured in Chrome at its defaults: −41 to −30 dB RMS, peaks at −17 dBFS or lower, in line with the classic six (−44 to −30). Light rain sits just above clear weather; heavy rain and storms are 3–6 dB louder.
- **Frontier Radio** costs more than the place alone. The extra notes measured about 25% more CPU (Longhorn Meadow: 29.4% alone, 36.9% in Radio, same run), after giving the music one stereo position instead of a panner per note and shortening the inner notes (19 simultaneous voices down to 12).
- **Soak test, 30 minutes** (Chrome, a dev build). It changed place every minute (all 25 in turn), set the time and weather every 90 s, changed the experience mode every 3 minutes, switched the world clock on and off every 5 minutes, and paused for 10 s every 7 minutes. Each minute it took a sample after a forced garbage collection:
  - the JS heap stayed between 12.0 and 13.1 MB, ending at 12.8 MB after Stop;
  - never more than two places at once (one fading out), then one;
  - pending timers 0–1;
  - the three noise buffers never remade;
  - no errors.

  After Stop there were no instances, nodes, voices, timers or ticker.
- **Bundle:** the Frontier code loads with the engine (the main bundle grew from 834.5 to 922.5 KB, before compression). The window (15 KB, 4.7 KB compressed) and the artwork load when it's first opened.

## Known limitations

- **Background tabs:** browsers may throttle or suspend audio in background tabs. Atmosphere schedules further ahead while hidden; if the browser suspends the context, it says so and needs Play.
- **One tab, while it's open:** playback is per tab, and one iWeb tab plays at a time. Nothing plays after the tab or browser closes. There's no offscreen document: iWeb is a single new-tab page, so playback never needs to survive navigation.
- **Autoplay:** the first Play must be a user gesture. A suggestion's notification click counts; nothing else starts sound.
- **Stereo, not 3D:** there's no Distance control, because Depth already covers space and reverb.
- **Not built:** Evolution has no separate intensity control (the four modes cover it), and there's no "Recently used" list.
- **Frontier World** has its own limitations, listed in [FRONTIER_WORLD.md](FRONTIER_WORLD.md#known-limitations).
- **Test coverage:** tests run in Node with a fake Web Audio API. Sound quality, interaction and the visuals were checked in Chrome; the UI's markup is covered by server-rendered tests.
