# iWeb Performance Optimization Report

The working record for the performance brief (`iweb-performance-optimization-claude-brief.md`): baseline, findings, changes per phase, and before/after measurements. Every number here was measured, and the setup is described with it.

## Test setup

| | |
|---|---|
| Machine | Windows 11 dev workstation |
| Browser | Chrome stable, run through Playwright (headless) and Lighthouse 13.6.0 (headless) |
| Build | `vite build` with source maps into a scratch folder (the shipped build has none), served by `vite preview` on port 4173 |
| Lighthouse | `--preset=desktop` (2 runs) and the default mobile emulation (4× CPU, slow 4G); clean profile each run |
| CPU throttling | Chrome DevTools Protocol `Emulation.setCPUThrottlingRate`: 1× (none) and 4× (a low-end device stand-in) |
| Profilers (scratchpad scripts) | `bundle-attrib.mjs` (bundle bytes by source module through the source map), `perf-runtime.mjs` (idle work, timers, rAF, WebGL, memory), `perf-cpu.mjs` (startup CPU profile by source module), `perf-renders.mjs` (React renders per phase through a DevTools-style hook, on the dev server), `perf-interact.mjs` (frame cost of interactions, leak check, warm-reload requests) |

**One build, two runtimes:** Vercel serves `dist/` as the PWA, and the release workflow zips the same `dist/` as the Chrome extension. Code changes apply to both; runtime checks are done for each.

**Limits:** headless Chrome renders with a software GPU, so the GPU cost of glass is under-reported. There's no real low-end device in the loop, so 4× CPU throttling stands in for one. The `/api` functions aren't served by `vite preview`, so those widgets show their offline state locally.

---

## Phase 0: Baseline

### Lighthouse (local preview build)

| Run | Perf | A11y | Best Pr. | SEO | FCP | LCP | TBT | CLS | SI |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Desktop #1 | 95 | 98 | 92 | 83 | 0.25 s | 1.45 s | 79 ms | 0 | 0.67 s |
| Desktop #2 | 95 | 98 | 92 | 83 | 0.25 s | 1.49 s | 55 ms | 0 | 0.66 s |
| **Mobile** (4× CPU, slow 4G) | **64** | 98 | 92 | 83 | 0.91 s | **6.42 s** | **514 ms** | 0.01 | 2.73 s |

Hosted report supplied with the brief (`iweb-two.vercel.app`, desktop): Perf 93, A11y 99, Best Practices 73, SEO 91, FCP 1.1 s, LCP 1.4 s, TBT 60 ms. Best Practices is higher locally because Vercel's headers and the ImageKit cookie aren't part of a local run.

**LCP is the clock (`span#clock`).** Its delay is almost all *element render delay* (about 0.9–1.0 s on desktop): the clock is waiting on JavaScript, not on the network.

### Bundle

| Asset | Raw | Gzip |
|---|---:|---:|
| `index-*.js` (main, loaded at startup) | 2,036 kB | **599 kB** |
| `index-*.css` (all styles, render-blocking) | 205 kB | 37.7 kB |
| Lazy already: `MarketsModal`, `NewsModal`, `vibrant`, `search.worker` | 41 / 12 / 11 / 79 kB | |

Main bundle by source (raw bytes):

| Module | KiB | Needed for the first frame? |
|---|---:|---|
| react-dom | 175 | yes |
| **music-metadata + readable-stream + buffer + file-type + tslib** | **~280** | no: only used when scanning a music folder |
| framer-motion + motion-dom | 144 | no: Spotlight and wallpaper settings only |
| **jszip** | 95 | no: backups and updates |
| **dexie** | 94 | no: Spotlight history |
| gsap | 84 | no: widget expand animations |
| **typesense + axios** | **121** | **never**: the Typesense client is never configured |
| Music.jsx | 59 | partly: the Dynamic Island |
| flexsearch + fuse.js | 78 | no: Spotlight and Music search |
| marked + dompurify | 79 | no: Notes preview |
| howler | 35 | no: until something plays |
| search-bar-text.js + quote.js (phrase lists) | 88 | one phrase each |

Lighthouse: 365 KiB of unused JS and 34 KiB of unused CSS at startup.

### Startup CPU (4× CPU, first 3 s, self time by source)

| Self time | Source | Why |
|---:|---|---|
| 390 ms | (program) | parsing and compiling the 2 MB bundle |
| **283 ms** | `GlassSurface.jsx` `measure` | `getBoundingClientRect` forced layout, repeated every frame for 700 ms by the settle loop, for each of the 8 surfaces |
| 194 ms | react-dom | rendering the full tree |
| **94 ms** | howler | `Howler.volume()` on Music mount creates an `AudioContext` and probes codecs |
| 71 ms | dexie | the search database opens at startup (`useSearch` in the always-mounted Spotlight) |
| 55 ms | `staticGlass.js` | WebGL setup and painting the static glass (expected) |
| 25 / 22 ms | marked / gsap | module setup |

At 1× CPU there's **one 381 ms long task** at startup (a long animation frame blocking for 391 ms).

**Forced reflow (Lighthouse, mapped through the source map):** `GlassSurface.jsx:23` (51 ms), React commit (41 ms), `genie/backdrop.js:10` (`getComputedStyle` at startup).

### Runtime

| Check | Result |
|---|---|
| Idle for 10 s (static and Liquid glass) | **0 rAF callbacks, 0 layouts**, about 1 ms of script. No perpetual render loop. |
| Intervals | 6, from Music, news rotation, NewsWidget, Clock, Quote and SearchBar (1 s to 60 s). Idle cost is negligible; the clock only re-renders when the minute changes. |
| WebGL contexts | 1 (static glass shares a single context across 8 surfaces); 0 in Liquid mode (SVG filters) |
| DOM at startup | 538 elements, of which **100 are the hidden Music library window** |
| `#displacementFilter` SVG in `index.html` | not referenced by anything (dead markup, not computed) |

**React renders** (dev server, DevTools-style commit walk that skips untouched subtrees):

| Phase | Commits | What renders |
|---|---:|---|
| Idle 10 s | 5 | NewsWidget, Clock, StatusIcons |
| Widget drag (60 moves) | 9 | refs drive the drag (good) |
| **Dock hover** | **76** | **GlassSurface ×61**: the Dock's size changes every frame, so each surface re-measures and stores a new box |
| **Open Control Center** | **34** | **GlassSurface ×211**: settle loops of the 13 tiles while they animate in |

**Interaction cost (production preview):**

| Interaction | WebGL glass repaints | Forced `getBoundingClientRect` | Long frames |
|---|---:|---:|---|
| Dock hover sweep (2.3 s) | 181 | 336 | 0 |
| Open Control Center (1.5 s) | 216 | 528 | 2 (max 78 ms at 1×, 109 ms at 4×) |

In static mode every change to a surface's box re-paints its glass with WebGL and copies it to a 2D canvas. That happens for every frame of Dock magnification and of a panel's entrance. It's the most likely cause of the intermittent sluggishness, especially on integrated GPUs, which headless Chrome can't show.

**Leaks:** opening and closing Notes, Settings and Control Center 8 times changed DOM nodes 2,280 → 2,284 and listeners 522 → 522; the heap went 7.7 → 9.0 MB after GC. No leak found.

### Network (cold load: 24 external or API requests)

| Request | Cached across new tabs? | Notes |
|---|---|---|
| `ipapi.co/json` (location) | **no** | every new tab, unless a city was searched; ipapi has tight rate limits |
| `api.met.no` forecast | **no** | every new tab; ~0.6–2 s; no timeout |
| `api.bigdatacloud.net` reverse geocode | no | only with geolocation permission; not in the extension's host permissions |
| MET weather icons (jsDelivr, 6) | browser cache only (7 days) | |
| `open.er-api.com` rates | has a TTL cache | the request **failed** (connection reset) and falls back to Frankfurter every time |
| `cdn.jsdelivr.net` gold and silver | TTL 6 h | |
| `/api/market` ×2, `/api/news` | have TTLs | still requested again on a warm reload (to check) |
| ImageKit fonts (2 at startup) | browser cache | **no `font-display`**; no preconnect |
| ImageKit Dock icons (5 SVG, 7–35 kB) | browser cache | |

No request blocks the first frame: widgets fetch on their own. But nothing has a stale-while-revalidate cache for weather, and only News sets a request timeout.

### Code and test baseline

- `npx vitest run`: **541 passed**, 40 files.
- `npx eslint .`: **75 problems (70 errors, 5 warnings)**, all in existing code. They are tracked so the count doesn't grow.
- `vite build`: succeeds, with 2 existing warnings (`import.meta` in the worker; chunk size).

---

## Plan (small, testable changes, in the brief's order)

**Phase 1: startup**
1. **GlassSurface measuring:** one batched read per frame for all surfaces instead of a 700 ms per-surface settle loop; re-measure on size changes and when an ancestor's animation or transition ends. Static glass repaints are coalesced while a size keeps changing (Dock magnification), with a final repaint when it settles.
2. **Lazy feature code:** `music-metadata` when scanning a folder; `jszip` for backups and updates; `typesense` only if configured; `marked` and `dompurify` when Notes renders Markdown; `gsap` when a widget first expands.
3. **Spotlight mounted on first use** (Ctrl K or click), with its chunk preloaded when the browser is idle: moves framer-motion, Radix, react-window, Dexie and the search worker out of startup.
4. **Howler:** no `AudioContext` until something plays.
5. **Fonts:** `font-display: swap` and a preconnect to ImageKit.

**Phase 2: runtime jank.** Fix the two non-composited animations (`cw-shimmer` with `background-position`, `news-headline-in` with `filter`) and the `getComputedStyle` read in `genie/backdrop.js`, then re-profile renders.

**Phase 3: glass.** Re-profile Dock and panels after phase 1; cap the static glass canvas resolution on high-DPR screens; handle WebGL context loss; pause glass work while the page is hidden.

**Phase 4: network.** Cache the location (until the user changes it) and the forecast (30 min, stale-while-revalidate), add timeouts and cancellation to weather, and check the warm-reload refetch of market and news.

**Phases 5–6:** narrow viewports and touch; `<main>` landmark; meta description; PWA security headers (CSP report-only first) in a `vercel.json`; source-map strategy.

---

## Changes and results

### Phase 1: startup

**Changes**

| Change | Files |
|---|---|
| Glass surfaces are measured in **one shared read pass per frame** (all reads, then all state updates), and again only on size changes, window resizes, or the end of an animation or transition around them. That replaces the 700 ms per-surface, per-frame settle loop. | `components/glass/GlassSurface.jsx` |
| Static glass repaints are **coalesced to at most one every 100 ms** while a size keeps changing (Dock magnification), with a final repaint when it settles, and **time-sliced** (an 8 ms budget per frame). A surface keeps its CSS frost until its glass is painted, then fades over. | `GlassSurface.jsx`, `styles/glass-surface.css` |
| Spotlight **mounts on first open**: Framer Motion, Radix, react-window, Dexie, the search engines and the worker leave startup. Its code is fetched when the browser is idle, so Ctrl K stays instant. | `App.jsx` |
| Settings **mounts on first open**, on the pane that was asked for (`initialTab`), and is fetched when idle. The Dock's Settings button now goes through `settings:open` like every other opener. | `App.jsx`, `SettingsModal.jsx` |
| Backups (`jszip`, `file-saver`, the search database) load when a backup is made or restored; the updater loads `jszip` when it installs. | `SettingsModal.jsx`, `settings/DataControlsPane.jsx`, `libs/updater/updater.js` |
| Typesense (with axios) loads only if a server is configured (it never is by default). | `search/services/TypesenseService.js` |
| Music: the tag reader (`music-metadata` and its stream polyfills) loads on the first folder scan; FlexSearch and Fuse load with the first library; **Howler's `AudioContext` starts with the first play** (the master volume waits until then, so the volume behaves exactly as before). | `components/Music.jsx` |
| Notes: the Preview renderer (`marked` + `DOMPurify`) moved to `markdownRender.js` and loads with the first Preview. | `libs/notes/markdown.js`, `libs/notes/markdownRender.js` (new), `components/Notes.jsx` |
| Search bar: the 45 kB phrase list loads after startup; the day's phrase is kept in localStorage so it shows on the first frame. | `search/components/SearchBar.jsx` |
| Fonts: `font-display: swap` on every face, and a preconnect to ImageKit. | `styles/fonts.css`, `index.html` |

**Results** (same machine, same tools as the baseline)

| | Baseline | Phase 1 |
|---|---:|---:|
| Main JS (gzip) | 599 kB | **232 kB** (target ≤ 300) |
| Main JS (raw) | 2,036 kB | 722 kB |
| Main CSS (gzip) | 37.7 kB | 30.8 kB |
| Lighthouse desktop: Perf / LCP | 95 / 1.45 s | 100 / **0.25 s** (run 1); 80 / 0.25 s (run 2, simulated TBT 457 ms) |
| Lighthouse mobile, simulated: Perf / LCP / TBT | 64 / 6.4 s / 514 ms | 73–75 / **0.91 s** / 1.4–1.7 s* |
| **Lighthouse mobile, applied throttling** (`--throttling-method=devtools`): Perf / FCP=LCP / TBT / JS bootup | 64–66 / 6.1–6.7 s / 0 ms / 1.0–1.4 s | **82 / 3.65–3.7 s / 25–67 ms / 0.69–0.71 s** |
| Dock hover sweep: WebGL repaints / forced reads | 181 / 336 | **25 / 71** |
| Open Control Center: WebGL repaints / forced reads | 216 / 528 | **22 / 33** |
| Open Control Center, longest frame (1× / 4× CPU) | 78 / 109 ms | 83 / 85 ms |

\* Lighthouse's default mobile mode *simulates* throttling from an unthrottled trace. It now counts the deferred work, such as idle preloads and glass painting after the first frame, as blocking time. With throttling actually applied, the same build shows the desktop 2.5 s sooner, TBT under 70 ms and about 40% less JavaScript at startup. The baseline's TBT of 0 only means all its work ran before anything appeared. Both numbers are kept here so the trade is visible.

**Checks**

- Tests 541/541 pass; lint 74 problems (75 at baseline, one fewer).
- **PWA (preview build):** Ctrl K opens Spotlight on first use and finds results; Settings first opens on the requested pane (About) and switches panes; the Dock opens Settings; backup export downloads `backup.iwebbackup`; Notes' Preview renders Markdown and DOMPurify still strips `onerror`; the search phrase shows on first load; no page errors.
- **Extension:** the build loaded unpacked in Chrome (through DevTools `Extensions.loadUnpacked`, since Chrome-branded builds ignore `--load-extension`). The New Tab page runs; lazy chunks and the search worker load under the extension CSP; Spotlight and Settings work; no errors.
- **Visual:** the settled Control Center is pixel-identical to the baseline; the Dock glass is unchanged.

**Not done in Phase 1, and why**

- **GSAP (68 KiB raw) is still in the startup bundle.** The widget expand animations run synchronously in effects whose cleanup kills running tweens. Making that asynchronous is riskier than its measured cost (about 22 ms at 4× CPU).
- **The quote list (42 KiB) stays,** because the quote is visible in the first frame.
- **Music's library window is still mounted while hidden** (about 100 DOM nodes). Its open, minimise and genie behaviour is tied to staying mounted; it's a candidate for Phase 2.

### Phase 2: runtime jank

**Changes**

| Change | Files |
|---|---|
| The loading shimmer (Currency, Gold & Silver, Markets) slides a highlight layer with `transform` instead of animating `background-position`: the same band of light, moved by the compositor instead of repainted every frame. Reduced motion still stops it. | `styles/widgets.css` |
| The News headline slide-in drops `filter: blur(2px)` and keeps its slide and fade (transform and opacity only). | `styles/news.css` |
| The genie's wallpaper warm-up waits for an idle moment and runs once for all windows, instead of each window reading computed styles while the desktop starts. | `libs/genie/backdrop.js` |

**Results**

| | Baseline | Phase 2 |
|---|---:|---:|
| Non-composited animations (Lighthouse) | 9 (shimmer ×7, headline, clock colour) | **1**: the clock's 200 ms colour fade, which only runs when the wallpaper changes |
| React commits during a Dock hover sweep (dev server) | 76 | **16** |
| React commits when opening Control Center | 34 (GlassSurface renders: 211) | **20** (GlassSurface renders: 44) |
| React commits while idle, 10 s | 5 | 2 |
| Lighthouse desktop: Perf / LCP / CLS | 95 / 1.45 s / 0 | 96 / 0.26 s / 0 |
| Lighthouse mobile, applied throttling: Perf / LCP / TBT | 64–66 / 6.1–6.7 s / 0 ms | **81–82 / 3.7–3.8 s / 50–106 ms** |

**Checks:** tests 541/541; lint 74 (baseline 75); the PWA functional script (Spotlight, Settings panes, Dock opener, backup export, Notes Preview) passes with no page errors; the extension New Tab passes with no errors.

### Start-up reveal (requested feature, after Phase 2)

Like logging in on macOS 26, the desktop appears from behind a dark, blurred veil, and the whole reveal takes **about 0.3 s**, so the loading behind it (the first render, the wallpaper, the glass painting) never shows.

- `#boot-veil` is styled inline in `index.html`, so it covers the first frame before any CSS or script loads; it's allowed under the extension's CSP.
- `libs/boot/bootReveal.js` lifts it when the app has rendered and the wallpaper is painted (plus 2 frames for the glass), and **never later than 120 ms** after the app's code starts. The fade is 0.18 s, opacity only; it never takes the pointer, it's removed from the page afterwards, and reduced motion gets a 0.1 s fade.
- **Measured (production preview, uploaded wallpaper, 3 runs):** at 1× CPU the veil lifts at 148–171 ms and is gone at **354–357 ms** after navigation; at 4× CPU it lifts at 308 ms and is gone at 554 ms. LCP stays at 200–236 ms (1×) and 292 ms (4×), because the veil covers the page rather than delaying it. The wallpaper and glass are in place by the end of the fade.
- **Trade-off:** each new tab is fully clear about 0.35 s after it opens, instead of showing parts as they arrive.

**Root re-render check:** no root-level re-render hotspot remains. While idle only NewsWidget re-renders, on its rotation. A widget drag stays at about 10 commits for 60 pointer moves (refs drive it). The clock re-renders once a minute.
