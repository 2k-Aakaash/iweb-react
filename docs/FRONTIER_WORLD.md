# Frontier World

Frontier World is a living landscape to listen to, inside iWeb Atmosphere. You choose a destination and a place. Its sound, picture, time of day, weather and occasional life then play together, and they keep changing as you listen.

It is an independent iWeb feature:

- **Names:** every name and description is iWeb's own, and a test checks the catalogue for place names from any game.
- **Sound and music:** synthesized or generated live in the browser. Nothing is recorded, downloaded or extracted, and nothing needs a licence.
- **Pictures:** drawn in code.

Frontier World runs on Atmosphere's one engine and store (see [ATMOSPHERE.md](ATMOSPHERE.md)). There is no second AudioContext and no separate audio state.

## Where things are

| Part | File |
| --- | --- |
| Destinations, places, the renamed-place map | `src/libs/ambience/frontier/catalogue.js` |
| Times, weathers, what they do to each kind of sound | `src/libs/ambience/frontier/conditions.js` |
| The world clock: time and weather moving by themselves | `src/libs/ambience/frontier/world.js` |
| The sound library (11 kinds of layer) | `src/libs/ambience/frontier/sounds.js` |
| Living-world events, the director, the event budget | `src/libs/ambience/frontier/events.js` |
| Generated music, Frontier Radio's songs | `src/libs/ambience/frontier/music.js` |
| Each place as an Atmosphere environment | `src/libs/ambience/frontier/environments.js` |
| Reserved: licensed recordings and their records | `src/libs/ambience/frontier/assets.js` |
| Engine methods, settings (v4), scenes | `engine.js`, `prefs.js`, `scenes.js` in `src/libs/ambience/` |
| The window | `src/components/ambience/FrontierWindow.jsx` |
| The landscape artwork, with cross-fades | `src/components/ambience/FrontierScenery.jsx` |
| The way in from Atmosphere | `src/components/ambience/FrontierWorld.jsx` |
| Shared pieces | `LayerRow.jsx`, `WeatherIcon.jsx` in `src/components/ambience/` |
| Styles | `src/styles/frontier.css` (in the Light appearance's scope) |
| Tests | `frontier.test.js`, `frontierWorld.test.js` in `src/libs/ambience/__tests__/` |

## Destinations and places

| Destination | Places | Weather |
| --- | --- | --- |
| Goldgrass Plains | Golden Mile, Windmill Ranch, Redclay Crossing, Longhorn Meadow, Alder Creek | the seven, plus Windy |
| Pinewater Valley | Pineglass River, Fernwood Basin, Elkshadow Grove, Mossfall Trail, Timberline Meadow | the seven |
| Ironpeak Range | Snowline Pass, Glasswater Tarn, Whitepine Camp, Highwind Shelf, Blue Glacier Run | no storms; Snowfall and Windy |
| Cypress Lowlands | Darkwater Fen, Heron Reach, Cypress Bend, Reedlight Marsh, Lantern Landing | the seven |
| Sunscour Desert | Copper Mesa, Dustwillow Wash, Suncrack Canyon, Coyote Flats, Drywell Outpost | no heavy rain or fog; Dust Wind |

"The seven" are Clear, Partly Cloudy, Overcast, Light Rain, Heavy Rain, Thunderstorm and Fog. Each destination also has:

- **Weather weights:** storms are always rare.
- **Dwell times:** how long a weather lasts, as a range of simulated minutes.

The Greenwater Isles are a planned later destination (`FUTURE_REGIONS`), not playable.

Each place records:

- its description and visual identity;
- tags;
- its own hour and weather;
- its water, wind and vegetation;
- what the artwork draws;
- its layers, each with a curated level and a source (`{ kind: 'synth', recipe }`);
- its living-world events;
- the music moods that suit it.

Places renamed before the first release (`LEGACY_LOCATION_IDS`) keep their saved mixes and scenes.

## Time and weather

**Times:** Dawn, Morning, Afternoon, Dusk and Night.

**Weathers:**

- Clear, Partly Cloudy, Overcast, Light Rain, Heavy Rain, Thunderstorm and Fog, where a destination allows them;
- Snowfall in Ironpeak only;
- Windy on the Plains and in Ironpeak;
- Dust Wind in Sunscour only.

A wind chosen in one destination becomes the local wind in another.

**How conditions change the sound.** Every kind of layer has a multiplier for each time and each weather. Continuous sound (wind, water, rain) takes it as a level; events take it as how often they happen:

- Night is busy with frogs and nearly empty of birds.
- Rain silences cicadas and wakes the frogs.
- Fog lowers the wind and makes the birds sparse.

The weather layer then plays the weather on the place's own surface: grass, leaves, water, rock, roof, sand or snow. It also carries snow hiss, wind-blown grit and thunder.

**The world clock** (`world.js`). These are pure functions, run on the engine's ticker and only while playing:

- **Time: Fixed.** The chosen hour, or the place's own, held.
- **Time: Real Time.** Follows the device's clock. Choosing an hour switches back to Fixed at that hour.
- **Time: Accelerated.** A simulated clock at 2, 6, 12 or 24 simulated minutes per real minute, so a day takes 12, 4, 2 or 1 hours. Choosing an hour restarts the clock there.
- **Weather: Locked.** The chosen weather, at every place, until Reset.
- **Weather: Simulated.** Each weather lasts at least its destination's dwell time, then moves to a neighbouring weather by weight. It never jumps from clear sky to a storm. Rain arrives as a front: the wind rises, and where storms happen there may be a distant roll of thunder, a few simulated minutes before the rain. Weather time runs at the clock's speed when Accelerated, and in real time otherwise.

Switching to Fixed or Locked keeps whatever was showing.

**How changes sound.** Nothing rebuilds; every change is a slow move:

| Change | Settles over |
| --- | --- |
| A choice made by hand | about 9 s |
| The hour moving on | about 40 s (Accelerated) or 90 s (Real Time) |
| A weather change | about 45 s |

As a phase goes on, the dawn chorus builds and the crickets join through dusk.

## Sound

There are eleven kinds of layer, each in several variants:

- air
- wind (prairie, pines, alpine, ridge, desert, marsh)
- foliage (grass, leaves, needles, reeds, brush)
- water (creek, river, waterfall, swamp, dock, lake ice)
- insects (cicadas by day, crickets after dark)
- frogs (peepers, bullfrogs, tree frogs)
- birds (five regional sets)
- wildlife
- distant life (ranch, farm, telegraph wires, settlement, dock, camp, empty outpost)
- fire (campfire, woodstove)
- weather

A place has five to eight of them.

- **Mute and mix:** every layer has its own mute and level. Muting keeps the level, and moving the slider unmutes.
- **Lazy beds:** sounds that only some conditions need exist only while they're needed, and are freed once they've faded. That covers rain, snow, grit, daytime cicadas and night-time crickets.
- **Fixed places:** each place puts its creek, ranch, fire, frogs and foliage in its own spot in the stereo field, the same every time.
- **Fog** closes a low-pass on distant layers (wildlife, distant life, birds and frogs).
- **Not built:** horses, footsteps, dogs and human voices don't synthesize convincingly, so there are none. A settlement is an indistinct murmur, hammering and a bell, never words.

## Living-world events

Each place has a pool of events, drawn from:

- a hawk or an eagle;
- coyotes, a wolf, an owl, an elk;
- cattle;
- a gust, a branch creaking, a woodpecker, a fish jumping, stones trickling;
- a train passing or far off, a steamboat, a bell across the water;
- wood being chopped, a barn door, a door creaking, a loose shutter;
- the fire settling.

A director plays them:

- **When:** only when the hour and weather suit the event, and only into a layer you can hear. A muted layer gets none, and the event takes that layer's level.
- **One at a time:** never the same one twice running, each with its own cooldown, roughly half a minute to two minutes apart.
- **How busy:** Event Intensity sets the pace (0.3× to 1.7×), and Variation adds to it.
- **Their own bus:** each event has a volume ceiling, a pan range and a distance. Further away is duller and quieter.
- **Answers:** coyotes, wolves, owls, elk and cattle are sometimes answered from the other side, further off.
- **Budget:** a shared event budget allows only 2–4 notable sounds to start in the same few seconds. That counts the director's events, bird phrases and distant life.

## Experience modes and music

| Mode | What you hear |
| --- | --- |
| Environmental | the place only |
| Cinematic | generated music kept under the ambience, at its own volume |
| Frontier Radio | music leads with generated songs; the ambience steps back to about 35%; a volume of its own |

- **Mode changes** crossfade over about 2.5 seconds.
- **Ambience volume** sits under the master.
- **Moods:** Frontier Calm, Long Ride, Campfire, Wilderness, Storm Approaching and Night Watch. **Auto** follows the hour and the weather.
- **The music** is plucked strings over a soft bowed pad, playing common folk accompaniment figures over chord progressions written for iWeb.
- **Radio songs** follow an A A′ B A shape: the last A brings back the first A's melody, and B moves to other chords. Each mood change waits for the end of the phrase.
- **Licensed music:** a licensed track can later take the place of the generated music (`assets.js`, the `original-music` source).

## The interface

**The Frontier World window** (`FrontierWindow.jsx`) behaves like other iWeb windows: it genies to and from its Dock icon, moves, resizes, snaps, and has a Controls menu in the menu bar.

- **Left:** the destinations, each opening to its places. Choosing a place plays it, with a crossfade.
- **Centre:**
  - the landscape, which cross-fades over about 1.6 s when the hour, weather or place changes;
  - the place's description, water, wind and growth;
  - a chip with the clock and weather;
  - a "… on its way" chip when a front is coming.
- **Right:**
  - Experience;
  - Time (mode, hour, speed);
  - Weather (mode, weather) and Reset;
  - Intensity (events, weather), ambience volume, music volume and mood;
  - Layers, each with mute;
  - what can happen at the place.
- **Bottom:** Now Playing: play or pause, stop, the place, its region, the clock and weather, a mode badge, volume and level bars.
- **Narrower windows:** below 1000 px the controls become a sheet over the scene, and below 700 px the places do too. Toolbar buttons open them, nothing depends on hover, and Escape closes a sheet before the window.

**Other ways in:**

- **Atmosphere's Frontier tab** is the way in: open the window, listen to the last place, and see the five destinations. The Frontier card in Explore opens the window too.
- **The Dynamic Island** shows a Frontier place's name, its weather icon and "Region · hour, weather". Its chip cycles the experience mode. Next goes to the next place in the destination, and Open goes to the window.
- **Apps** finds it under "frontier". The Dock shows its icon while the window runs, with Play/Pause and Next Place in the Dock menu.

**Accessibility:**

- Every control is a real button, radio group, slider or select with a label. Icon-only buttons have names.
- Weather is always written out next to its icon.
- Focus rings are visible.
- With reduced motion, nothing animates.

## The engine

A place is an environment like any other, so crossfades, disposal, evolution, stereo, focus sessions, the glow and scenes all apply. The engine adds these methods for Frontier World:

- **Places:** `openLocation(id, { play })`.
- **Conditions:** `setConditions({ time, weather })`, `resetConditions()`, `setTimeMode()`, `setWeatherMode()`, `setWorldModes()`, `setSpeed()`.
- **Experience and music:** `setMode()`, `setMusic({ enabled, volume, mood })`.
- **Tuning:** `setEventIntensity()`, `setWeatherIntensity()`, `setAmbienceVolume()`.
- **Layers:** `setLayerMuted()`, which works for every environment.

Its state includes `conditions`, which holds:

- `time` and `weather`;
- `clock`, `progress` and `front`;
- `source` and `isDefault`.

The state also carries `frontier` (the saved settings), `musicMood`, `muted` and `lite`.

**Lite:** after a minute hidden, or while the ticker keeps running late, events become sparser. The sound itself doesn't change.

## Settings

Settings are at version 4, in iWebDB, and included in backups. The `frontier` section holds:

- **Place:** the last destination and place.
- **Experience:** the mode.
- **Time:** the hour, time mode and speed.
- **Weather:** the weather and weather mode.
- **Tuning:** weather and event intensity, and the ambience volume.
- **Music:** the mood, and the Cinematic and Radio volumes.

Each environment also keeps its muted layers.

**Migration from version 3:**

| Version 3 | Becomes |
| --- | --- |
| Dynamic Atmosphere on | Accelerated time and Simulated weather |
| Music on | Cinematic, at the same volume |
| "evening" | Dusk |
| A renamed place's mix and scenes | Carried over |

Anything damaged falls back to its default.

## Recordings (reserved)

`assets.js` defines the record a licensed recording or track will need, and validates it:

- path, codec, length, sample rate and channels;
- the licence: type, proof, attribution and usage;
- loop points and crossfade;
- measured loudness and trim.

Nothing is loaded and no recording ships: `ASSETS` is empty, and every layer is synthesized.

## Failure handling

- **No sound before a click:** no sound and no AudioContext until a user gesture.
- **A blocked start or browser suspension** is said plainly ("Paused by the browser. Press Play to continue."). It is never retried in a loop.
- **A place that can't be built** gives a notice ("That environment couldn't start."), nothing else breaks, and the next place plays. This fix applies to every environment.
- **Rapid changes:** the newest wins. At most two old places fade at once, and they're disposed after about 3 seconds.
- **While paused:** the ticker, events, music and world clock all stop.

## Performance

See the Frontier World part of [ATMOSPHERE.md's performance section](ATMOSPHERE.md#performance-measured).

## Testing

**Unit tests** (Vitest, Node, a fake Web Audio API) cover:

- the catalogue and its originality;
- the place records and their weather;
- the renamed-place map and the recording records;
- what conditions do to each sound;
- drift and the world clock: phases, Accelerated, Real Time, dwell, neighbours and fronts;
- events: picking, cooldowns, answers and the budget;
- music: Auto moods, bars, Radio's lead and song shape;
- the engine: every place built and disposed, modes, volumes, intensities, lite, fog, fixed places, a place that can't start, mute, scenes;
- settings migration and repair;
- the window, the Atmosphere tab and the island, rendered on the server.

**In Chrome:** the blueprint's acceptance scenarios, plus reduced motion, the classic Atmosphere regression and console errors, all pass:

1. a fresh install;
2. sound from a click;
3. all 25 places;
4. rapid time and weather changes;
5. the three modes;
6. a focus session with Frontier and the island;
7. island control;
8. a hidden tab;
9. reload;
10. suspended audio and a failing place.

A 30-minute soak test with place changes every minute found no growth in nodes, timers or instances, and no errors. The heap stayed between 12.0 and 13.1 MB. Details are under performance.

## Known limitations

- **Missing sounds:** horses, footsteps, dogs and voices are left out (see Sound).
- **Music:** generated plucked strings and pads, not recorded instruments.
- **Artwork:** simple, static SVG landscapes drawn in code, not illustration.
- **No previews:** there are no audio previews on hover; browsing is silent, and choosing a place plays it.
- **One weather everywhere:** Locked weather is a single world setting. It applies at every place until Reset, and the panel says so.
- **Listening by ear:** the sound was checked by measurement (levels, peaks, events, nodes) and in Chrome. It still needs real listening on speakers and headphones.
