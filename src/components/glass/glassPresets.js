// Glass looks for <GlassSurface> (staticGlass.js renders them once). Surfaces:
//   panel, window, spotlight, dock, bar (the search field), pill (the Dynamic Island),
//   label (Dock icon names, the Unsplash credit), card (widgets), tile (Control Center).
// Values: tint [r, g, b, a]
// over the glass, blur (body frost, px), edgeBlur (rim blur as a fraction of blur — lower
// keeps the bending visible), refraction and bezel (rim lens strength and width, px),
// chroma (rim colour split), lift (+ milky / − darker), saturate, specular (rim light).
const staticBase = {
  tint: [16, 16, 24, 0.1],
  blur: 18,
  edgeBlur: 0.2,
  bezel: 24,
  refraction: 1.6,
  chroma: 0.012,
  lift: 0,
  saturate: 1.35,
  specular: 0.9,
}

export const STATIC_PRESETS = {
  panel: {...staticBase, tint: [255, 255, 255, 0.08], lift: 0.12},
  window: {
    ...staticBase,
    tint: [10, 12, 22, 0.42],
    blur: 14,
    bezel: 26,
    refraction: 2.5,
    specular: 0.7,
  },
  // Spotlight floats over the whole page: darker and more frosted so white text always reads.
  spotlight: {
    ...staticBase,
    tint: [12, 14, 24, 0.62],
    blur: 30,
    bezel: 22,
    refraction: 1.2,
    specular: 0.6,
  },
  // Clear glass (macOS 26 Dock): no frost inside; the curved rim does the work.
  dock: {
    ...staticBase,
    tint: [20, 20, 28, 0.06],
    lift: 0.08,
    blur: 4,
    edgeBlur: 1,
    bezel: 12,
    refraction: 2.6,
    saturate: 1.15,
  },
  bar: {
    ...staticBase,
    tint: [20, 20, 28, 0.1],
    lift: 0.05,
    blur: 6,
    edgeBlur: 1,
    bezel: 12,
    refraction: 2.6,
    saturate: 1.15,
  },
  pill: {
    ...staticBase,
    tint: [6, 6, 10, 0.6],
    bezel: 16,
    refraction: 2.5,
    specular: 1,
  },
  // Small text labels (Dock icon names, the Unsplash credit): frosted, dim enough for white text.
  label: {
    ...staticBase,
    tint: [14, 16, 24, 0.32],
    blur: 12,
    edgeBlur: 0.5,
    bezel: 9,
    refraction: 2,
    specular: 1,
  },
  card: {
    ...staticBase,
    tint: [0, 0, 0, 0],
    blur: 16,
    bezel: 18,
    refraction: 1.5,
    lift: 0.04,
  },
}

// Control Center's tiles: the widgets' clear glass in Dark, milky in Light.
STATIC_PRESETS.tile = STATIC_PRESETS.card

// Light appearance (Settings → Appearance). Presets not listed here look the same in both.
// One light glass for every surface, the Control Center tiles' look: frosted, see-through to
// the wallpaper, a little lift for dark text. Spotlight floats over everything: a touch denser.
export const LIGHT_STATIC_PRESETS = {
  // Windows hold the most text: a little more frost than the tiles, the same look.
  window: { ...STATIC_PRESETS.window, tint: [250, 250, 252, 0.38], lift: 0.05 },
  spotlight: { ...STATIC_PRESETS.spotlight, tint: [250, 250, 252, 0.38], lift: 0.05 },
  tile: { ...STATIC_PRESETS.card, tint: [250, 250, 252, 0.3], lift: 0.04 },
}
