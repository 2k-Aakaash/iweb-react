// Frontier World's sound sources: what a layer's `source` may be, and the record a licensed
// recording or track will need when there is one. Reserved only: nothing is loaded and no
// recording ships. Every layer is synthesized today ({ kind: 'synth' }); the generated music
// is music.js. A future licensed file is added to ASSETS with its full licence record, and a
// layer points at it with { kind: 'licensed-audio', assetId }.
//
//   asset {
//     id, path,                              where the file is (bundled path or URL)
//     codec, durationSec, sampleRate, channels,
//     licence: { type, reference, attribution, usage },   proof that it may be used, and how
//     loop: { startSec, endSec, crossfadeMs } | null,      seamless loop points
//     loudness: { lufs, trimDb }                           its measured level and trim
//   }

export const SOURCE_KINDS = Object.freeze(['synth', 'licensed-audio', 'original-music']);

/** No recordings are bundled yet. */
export const ASSETS = Object.freeze([]);

const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const isNum = (v, min = -Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= min;

/** The problems with an asset record (empty when it's complete and consistent). */
export function validateAsset(a) {
  const problems = [];
  if (!a || typeof a !== 'object') return ['not a record'];
  if (!isText(a.id)) problems.push('id');
  if (!isText(a.path)) problems.push('path');
  if (!isText(a.codec)) problems.push('codec');
  if (!isNum(a.durationSec, 0.1)) problems.push('durationSec');
  if (!isNum(a.sampleRate, 8000)) problems.push('sampleRate');
  if (!(a.channels === 1 || a.channels === 2)) problems.push('channels');
  const l = a.licence;
  if (!l || !isText(l.type) || !isText(l.reference) || typeof l.attribution !== 'string' || !isText(l.usage)) problems.push('licence');
  if (a.loop != null) {
    const { startSec, endSec, crossfadeMs } = a.loop;
    if (!isNum(startSec, 0) || !isNum(endSec, 0) || endSec <= startSec || (isNum(a.durationSec) && endSec > a.durationSec) || !isNum(crossfadeMs, 0)) problems.push('loop');
  }
  if (!a.loudness || !isNum(a.loudness.lufs) || !isNum(a.loudness.trimDb)) problems.push('loudness');
  return problems;
}

/** The problems with a layer's source (empty when it's usable). */
export function validateSource(source, assets = ASSETS) {
  if (!source || !SOURCE_KINDS.includes(source.kind)) return ['kind'];
  if (source.kind === 'synth') return isText(source.recipe) ? [] : ['recipe'];
  if (source.kind === 'licensed-audio') {
    const asset = assets.find((a) => a.id === source.assetId);
    if (!asset) return ['assetId'];
    return validateAsset(asset).map((p) => `asset.${p}`);
  }
  return isText(source.trackId) ? [] : ['trackId'];
}
