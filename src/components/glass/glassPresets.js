// Optics presets for <GlassSurface> (@samasante/liquid-glass `optics`).
//   panel  — the library's macOS notification look: milky veil, gentle rim bend.
//   window — the same glass with a dark veil, for windows with white text.
//   dock   — wide bars: no dome (a full-width lens would bloom into an oval, as the library
//            warns) and per-axis strength, so the vertical bend stays proportional to the height.
//   bar    — the dock look for slimmer bars (the search field).
//   pill   — small capsules like the Dynamic Island.
//   card   — widgets: a light frost under their colour tint.
//   label  — small text labels: Dock icon names, the Unsplash credit.
// `frost` is much stronger than a CSS blur radius: around 1–3 already frosts well.

const panel = {
  mapSize: 256,
  clipToShape: true,
  softEdge: true,
  depth: 1,
  curvature: 0.5,
  dispersion: 0.6,
  strength: 0.17,
  bend: 0.7,
  bendWidth: 0.12,
  frost: 3,
  brightness: 0.22,
  specular: 1.3,
  sheenAngle: 50,
  glow: 0.32,
  glowSpread: 1,
  glowFalloff: 1,
  sheen: 1.3,
  sheenWidth: 3,
}

const dock = {
  mapSize: 256,
  clipToShape: true,
  softEdge: true,
  depth: 0.95,
  curvature: 0.5,
  dispersion: 0.6,
  strength: 0.14,
  bend: 0.4,
  bendWidth: 0.7,
  frost: 1,
  brightness: 0.05,
  specular: 1.3,
  sheenAngle: 50,
  glow: 0.15,
  glowSpread: 1,
  glowFalloff: 1,
  sheen: 1.3,
  sheenWidth: 2.5,
}

export const GLASS_PRESETS = {
  panel,
  window: {...panel, brightness: -0.3},
  spotlight: {...panel, brightness: -0.55},
  dock,
  bar: {...dock, scaleX: 0.04, scaleY: 0.01, bendWidth: 0.35, brightness: 0.02},
  pill: {
    ...panel,
    depth: 0.6,
    curvature: 0.2,
    dispersion: 0.4,
    strength: 0.06,
    bend: 0.8,
    bendWidth: 0.25,
    frost: 1.5,
    brightness: -0.35,
    glow: 0.2,
    sheen: 1.1,
    sheenWidth: 2,
  },
  card: {
    ...panel,
    depth: 0.6,
    curvature: 0.2,
    strength: 0.08,
    bend: 0.8,
    bendWidth: 0.18,
    frost: 1.5,
    brightness: 0,
  },
  label: {
    ...panel,
    depth: 0.5,
    curvature: 0.2,
    dispersion: 0.3,
    strength: 0.05,
    bend: 0.8,
    bendWidth: 0.3,
    frost: 2,
    brightness: -0.25,
    glow: 0.2,
    sheen: 1.1,
    sheenWidth: 2,
  },
}

// Static glass (staticGlass.js) — the same surfaces, rendered once. Values: tint [r, g, b, a]
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
