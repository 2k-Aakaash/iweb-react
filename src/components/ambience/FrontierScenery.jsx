import { memo, useId, useMemo, useState } from 'react';
import { locationById, regionById } from '../../libs/ambience/frontier/catalogue.js';
import { seeded } from '../../libs/ambience/random.js';

// Frontier World's artwork: a landscape drawn in SVG from code, for a region and location,
// at an hour and in a weather. Original, nothing downloaded, nothing to license, and it
// redraws for every condition (dawn light, night stars, rain, snow). Static: no animation
// runs, it only fades in when the picture changes.

const W = 480;
const H = 200;

const SKY = {
  dawn: ['#2d3a63', '#a7728a', '#f2b88a'],
  morning: ['#5f93cf', '#9cc3e6', '#e3eef5'],
  afternoon: ['#3f7fc8', '#86b7e3', '#d5e7f3'],
  dusk: ['#2a2346', '#a2506a', '#f0a25e'],
  night: ['#060a18', '#111b36', '#24325a'],
};
const SUN = {
  dawn: { x: 0.18, y: 0.6, c: '#ffd2a0', r: 13 },
  morning: { x: 0.3, y: 0.28, c: '#fff6dc', r: 11 },
  afternoon: { x: 0.62, y: 0.18, c: '#fffbe8', r: 11 },
  dusk: { x: 0.82, y: 0.56, c: '#ffb070', r: 14 },
  night: { x: 0.72, y: 0.2, c: '#eef2ff', r: 8, moon: true },
};
// How each hour tints the land: [colour, amount].
const SHADE = { dawn: ['#4a3a5a', 0.3], morning: ['#ffffff', 0], afternoon: ['#ffffff', 0], dusk: ['#3a2440', 0.4], night: ['#0b1222', 0.72] };
const LAND = {
  plains: { far: '#8a9a6a', mid: '#9e9a55', near: '#b8a258' },
  valley: { far: '#6d86a0', mid: '#2f5a45', near: '#5d8a4e' },
  ironpeak: { far: '#7f93ab', mid: '#4d6a7a', near: '#dfe7ef', snow: '#eef3f8' },
  lowlands: { far: '#4e6650', mid: '#34503d', near: '#4a5e3e', water: '#5f7f86' },
  desert: { far: '#c17a52', mid: '#a85a38', near: '#d6a06a' },
};

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
function mix(a, b, t) {
  const [x, y] = [hex(a), hex(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A ridgeline from left to right, closed to the bottom. */
function ridge(rng, { base, amp, jag = 0.3, n = 14, flat = 0 }) {
  const pts = [];
  const phase = rng() * 6;
  for (let i = 0; i <= n; i += 1) {
    const x = (i / n) * W;
    const smooth = Math.sin(i * 0.7 + phase) * 0.6 + Math.sin(i * 1.9 + phase * 2) * 0.4;
    let y = base * H - (smooth * amp * H) - (rng() - 0.5) * jag * amp * H;
    if (flat && rng() < flat) y = pts.length ? pts[pts.length - 1][1] : y;
    pts.push([x, y]);
  }
  return `M0 ${H} ${pts.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')} L${W} ${H} Z`;
}

/** Flat-topped mesas and buttes on a horizon. */
function mesas(rng, base, count, height) {
  let d = `M0 ${H} L0 ${base * H}`;
  let x = 0;
  for (let i = 0; i < count && x < W; i += 1) {
    const gap = 20 + rng() * 60;
    const w = 30 + rng() * 90;
    const h = height * H * (0.5 + rng() * 0.6);
    const y = base * H;
    d += ` L${x + gap} ${y} L${x + gap + 8} ${y - h} L${x + gap + w - 8} ${y - h} L${x + gap + w} ${y}`;
    x += gap + w;
  }
  return `${d} L${W} ${base * H} L${W} ${H} Z`;
}

function Scenery({ regionId, locationId, time = 'afternoon', weather = 'clear', className = '' }) {
  const art = useMemo(() => {
    const location = locationById(locationId);
    const region = regionById(regionId || location?.regionId) || regionById('plains');
    const rng = seeded(hash(location?.id || region.id));
    const features = new Set(location?.scenery?.features || []);
    const land = LAND[region.id];
    const [shadeTo, shadeAmt] = SHADE[time] || SHADE.afternoon;
    const wet = ['light-rain', 'heavy-rain', 'thunderstorm'].includes(weather);
    const grey = weather === 'overcast' || wet || weather === 'snowfall' ? 0.28 : weather === 'fog' ? 0.18 : 0;
    const tint = (c) => mix(mix(c, shadeTo, shadeAmt), '#5a6270', grey);
    const night = time === 'night';
    const lit = time === 'dusk' || night;
    const sky = SKY[time] || SKY.afternoon;
    const sun = SUN[time] || SUN.afternoon;
    const hidden = grey > 0;

    const far = region.id === 'desert'
      ? mesas(rng, 0.6, 5, 0.16)
      : ridge(rng, {
        plains: { base: 0.58, amp: 0.035, jag: 0.2 },
        valley: { base: 0.52, amp: 0.15, jag: 0.6, n: 18 },
        ironpeak: { base: 0.5, amp: 0.2, jag: 0.9, n: 20 },
        lowlands: { base: 0.6, amp: 0.012, jag: 0.4, n: 10 },
      }[region.id]);
    const mid = ridge(rng, {
      plains: { base: features.has('twin') ? 0.66 : 0.68, amp: features.has('twin') ? 0.09 : 0.04, jag: 0.2, n: features.has('twin') ? 6 : 12 },
      valley: { base: 0.66, amp: 0.05, jag: 0.4 },
      ironpeak: { base: 0.66, amp: 0.07, jag: 0.6 },
      lowlands: { base: 0.66, amp: 0.01, jag: 0.3, n: 8 },
      desert: { base: 0.7, amp: 0.03, jag: 0.4 },
    }[region.id]);
    const near = ridge(rng, { base: 0.82, amp: 0.025, jag: 0.3, n: 10 });

    const trees = (kind, count, yBase, scale, color) => Array.from({ length: count }, (_, i) => {
      const x = ((i + rng() * 0.8) / count) * W;
      const s = scale * (0.7 + rng() * 0.6);
      const y = yBase * H + rng() * 6;
      return { kind, x, y, s, color, id: `${kind}${i}` };
    });
    const pines = [];
    if (features.has('pines-far')) pines.push(...trees('pine', 26, 0.6, 7, tint(mix(land.far, '#1d3a2c', 0.55))));
    if (features.has('pines')) pines.push(...trees('pine', 18, 0.7, 16, tint('#1f3d2e')));
    const cypress = [];
    if (features.has('cypress-far')) cypress.push(...trees('cypress', 9, 0.62, 10, tint('#2b3d2c')));
    if (features.has('cypress')) cypress.push(...trees('cypress', 6, 0.72, 26, tint('#1f2d21')));
    const scrub = features.has('scrub') ? trees('scrub', 14, 0.84, 4, tint('#6f6a3a')) : [];
    const cacti = features.has('cactus') ? trees('cactus', 3, 0.86, 16, tint('#4f5b33')) : [];
    const stars = night && !hidden ? Array.from({ length: 46 }, (_, i) => ({ x: rng() * W, y: rng() * H * 0.5, r: 0.4 + rng() * 0.9, o: 0.35 + rng() * 0.6, key: i })) : [];
    const rain = wet ? Array.from({ length: weather === 'light-rain' ? 60 : 130 }, (_, i) => ({ x: rng() * (W + 40), y: rng() * H, key: i })) : [];
    const snow = weather === 'snowfall' ? Array.from({ length: 90 }, (_, i) => ({ x: rng() * W, y: rng() * H, r: 0.6 + rng() * 1.2, key: i })) : [];
    const blades = features.has('grass') ? Array.from({ length: 70 }, (_, i) => ({ x: rng() * W, h: 6 + rng() * 12, lean: (rng() - 0.3) * 5, key: i })) : [];
    const reeds = features.has('reeds') ? Array.from({ length: 90 }, (_, i) => ({ x: rng() * W, h: 18 + rng() * 34, lean: (rng() - 0.5) * 4, key: i })) : [];
    // Partly cloudy: a few soft clouds drifting nowhere (static).
    const clouds = weather === 'partly-cloudy' ? Array.from({ length: 4 }, (_, i) => ({ x: (i + 0.2 + rng() * 0.6) * (W / 4), y: H * (0.12 + rng() * 0.2), w: 40 + rng() * 40, key: i })) : [];
    return { region, land, sky, sun, hidden, night, lit, far, mid, near, tint, pines, cypress, scrub, cacti, stars, rain, snow, blades, reeds, clouds, features, wet, weather };
  }, [regionId, locationId, time, weather]);

  const { land, sky, sun, hidden, lit, tint, features } = art;
  const id = `fs${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const waterish = features.has('water') || art.region.id === 'lowlands';
  const fireGlow = features.has('fire') && lit;

  return (
    <svg className={`frontier-scenery ${className}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky[0]} />
          <stop offset="0.55" stopColor={sky[1]} />
          <stop offset="1" stopColor={sky[2]} />
        </linearGradient>
        <radialGradient id={`${id}-sun`}>
          <stop offset="0" stopColor={sun.c} stopOpacity="0.9" />
          <stop offset="1" stopColor={sun.c} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-water`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky[2]} stopOpacity="0.75" />
          <stop offset="1" stopColor={tint(land.water || '#4f6f7a')} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${id}-sky)`} />
      {art.stars.map((s) => <circle key={s.key} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={s.o} />)}
      <g opacity={hidden ? 0.25 : 1}>
        <circle cx={sun.x * W} cy={sun.y * H} r={sun.r * (sun.moon ? 2.4 : 4)} fill={`url(#${id}-sun)`} opacity={sun.moon ? 0.45 : 1} />
        <circle cx={sun.x * W} cy={sun.y * H} r={sun.r} fill={sun.c} />
        {sun.moon && <circle cx={sun.x * W + 3.5} cy={sun.y * H - 2} r={sun.r * 0.85} fill={sky[0]} />}
      </g>

      <path d={art.far} fill={tint(land.far)} />
      {land.snow && <path d={art.far} fill={tint(land.snow)} />}
      {land.snow && <path d={art.far} fill={tint(land.far)} transform="translate(0 16)" />}
      {art.pines.filter((p) => p.s < 12).map((p) => <Pine key={p.id} {...p} />)}
      {art.cypress.filter((p) => p.s < 14).map((p) => <Cypress key={p.id} {...p} />)}
      {features.has('cliffs') && (
        <g fill={tint('#8e4428')}>
          <path d={`M0 ${H} L0 ${H * 0.25} L40 ${H * 0.3} L70 ${H * 0.62} L90 ${H} Z`} />
          <path d={`M${W} ${H} L${W} ${H * 0.3} L${W - 50} ${H * 0.34} L${W - 80} ${H * 0.66} L${W - 100} ${H} Z`} />
        </g>
      )}
      <path d={art.mid} fill={tint(land.mid)} />
      {features.has('falls') && (
        <g>
          <path d={`M${W * 0.68} ${H * 0.3} L${W * 0.74} ${H * 0.3} L${W * 0.76} ${H * 0.8} L${W * 0.66} ${H * 0.8} Z`} fill={tint('#3d4f4a')} />
          <rect x={W * 0.695} y={H * 0.3} width={W * 0.03} height={H * 0.5} fill="#e8f2f6" opacity="0.85" />
          <ellipse cx={W * 0.71} cy={H * 0.8} rx={W * 0.08} ry={H * 0.05} fill="#f4f8fa" opacity="0.55" />
        </g>
      )}
      {art.pines.filter((p) => p.s >= 12).map((p) => <Pine key={p.id} {...p} />)}
      {features.has('windmill') && <Windmill x={W * 0.74} y={H * 0.72} color={tint('#3b3328')} />}
      {features.has('barn') && <Building x={W * 0.2} y={H * 0.74} w={44} h={26} color={tint('#7a3b2c')} roof={tint('#4b2a22')} lit={false} />}
      {features.has('cabin') && <Building x={W * 0.3} y={H * 0.78} w={38} h={20} color={tint('#5a4330')} roof={tint('#3a2c22')} lit={lit} />}
      {features.has('houses') && [0.18, 0.34, 0.52].map((x, i) => <Building key={i} x={W * x} y={H * 0.66} w={30 + i * 4} h={18} color={tint('#4d4234')} roof={tint('#352c24')} lit={lit} stilts />)}
      {features.has('rail') && <Railway color={tint('#3a3530')} />}

      {waterish ? (
        <g>
          <rect x="0" y={H * 0.7} width={W} height={H * 0.3} fill={`url(#${id}-water)`} />
          {[0.76, 0.82, 0.9].map((y) => <line key={y} x1={W * 0.1} x2={W * 0.9} y1={H * y} y2={H * y} stroke="#ffffff" strokeOpacity="0.12" strokeWidth="1" />)}
        </g>
      ) : (
        <path d={art.near} fill={tint(features.has('snow') ? '#e3ebf2' : land.near)} />
      )}
      {(features.has('river') || features.has('creek')) && (
        <path d={`M${W * 0.12} ${H} C${W * 0.3} ${H * 0.86} ${W * 0.55} ${H * 0.92} ${W * 0.7} ${H * 0.78}`} fill="none" stroke={sky[2]} strokeOpacity="0.7" strokeWidth={features.has('river') ? 8 : 4} strokeLinecap="round" />
      )}
      {features.has('lake-ice') && (
        <g>
          <ellipse cx={W * 0.5} cy={H * 0.86} rx={W * 0.42} ry={H * 0.08} fill={tint('#cfe0ec')} />
          <path d={`M${W * 0.25} ${H * 0.85} L${W * 0.4} ${H * 0.88} L${W * 0.52} ${H * 0.84} L${W * 0.7} ${H * 0.87}`} stroke={tint('#8fa9bd')} strokeWidth="0.8" fill="none" />
        </g>
      )}
      {features.has('dock') && (
        <g fill={tint('#5a4632')}>
          <rect x={W * 0.05} y={H * 0.74} width={W * 0.42} height={5} />
          {[0.08, 0.18, 0.28, 0.38, 0.46].map((x) => <rect key={x} x={W * x} y={H * 0.74} width={3} height={18} />)}
        </g>
      )}
      {features.has('fence') && (
        <g stroke={tint('#4a3d2c')} strokeWidth="1.4">
          {Array.from({ length: 12 }, (_, i) => <line key={i} x1={20 + i * 40} x2={20 + i * 40} y1={H * 0.8} y2={H * 0.88} />)}
          <line x1="0" x2={W} y1={H * 0.82} y2={H * 0.815} />
          <line x1="0" x2={W} y1={H * 0.855} y2={H * 0.85} />
        </g>
      )}
      {features.has('cottonwood') && [0.15, 0.82].map((x) => (
        <g key={x} fill={tint('#4d6a3a')}>
          <rect x={W * x - 2} y={H * 0.62} width={4} height={H * 0.2} fill={tint('#4a3a2a')} />
          <ellipse cx={W * x} cy={H * 0.58} rx={26} ry={20} />
        </g>
      ))}
      {art.cypress.filter((p) => p.s >= 14).map((p) => <Cypress key={p.id} {...p} />)}
      {art.scrub.map((p) => <ellipse key={p.id} cx={p.x} cy={p.y} rx={p.s * 1.6} ry={p.s} fill={p.color} />)}
      {art.cacti.map((p) => <Cactus key={p.id} {...p} />)}
      {art.blades.length > 0 && (
        <g stroke={tint(mix(land.near, '#3d4a22', 0.45))} strokeWidth="1" strokeLinecap="round">
          {art.blades.map((b) => <line key={b.key} x1={b.x} y1={H} x2={b.x + b.lean} y2={H - b.h} />)}
        </g>
      )}
      {art.reeds.length > 0 && (
        <g stroke={tint('#5d6a3a')} strokeWidth="1.2" strokeLinecap="round">
          {art.reeds.map((b) => <line key={b.key} x1={b.x} y1={H} x2={b.x + b.lean} y2={H - b.h} />)}
        </g>
      )}
      {fireGlow && (
        <g>
          <ellipse cx={W * 0.46} cy={H * 0.86} rx={26} ry={10} fill="#ffb15a" opacity="0.35" />
          <path d={`M${W * 0.46 - 5} ${H * 0.87} Q${W * 0.46} ${H * 0.78} ${W * 0.46 + 5} ${H * 0.87} Z`} fill="#ffcf73" />
        </g>
      )}

      {art.clouds.map((c) => (
        <g key={c.key} fill="#ffffff" opacity={art.night ? 0.12 : 0.55}>
          <ellipse cx={c.x} cy={c.y} rx={c.w} ry={c.w * 0.22} />
          <ellipse cx={c.x - c.w * 0.35} cy={c.y + 2} rx={c.w * 0.5} ry={c.w * 0.18} />
          <ellipse cx={c.x + c.w * 0.3} cy={c.y - 3} rx={c.w * 0.45} ry={c.w * 0.2} />
        </g>
      ))}
      {art.weather === 'fog' && (
        <g>
          <rect width={W} height={H} fill="#d9dee4" opacity={art.night ? 0.18 : 0.32} />
          {[0.55, 0.68, 0.8].map((y, i) => <rect key={y} x="0" y={H * y} width={W} height={H * 0.1} fill="#eef1f4" opacity={(art.night ? 0.12 : 0.28) - i * 0.04} />)}
        </g>
      )}
      {art.weather === 'dust-wind' && (
        <g>
          <rect width={W} height={H} fill="#c98b54" opacity="0.28" />
          <g stroke="#f3d2a2" strokeOpacity="0.3" strokeWidth="1" strokeLinecap="round">
            {[0.36, 0.5, 0.62, 0.74].map((y, i) => <line key={y} x1={20 + i * 70} x2={160 + i * 70} y1={H * y} y2={H * y - 5} />)}
          </g>
        </g>
      )}
      {art.weather === 'windy' && (
        <g stroke="#ffffff" strokeOpacity="0.18" strokeWidth="1" strokeLinecap="round">
          {[0.3, 0.42, 0.55].map((y, i) => <line key={y} x1={40 + i * 90} x2={140 + i * 90} y1={H * y} y2={H * y - 4} />)}
        </g>
      )}
      {art.rain.length > 0 && (
        <g stroke="#dfe8f2" strokeOpacity={art.weather === 'light-rain' ? 0.35 : 0.45} strokeWidth="0.8">
          {art.rain.map((d) => <line key={d.key} x1={d.x} y1={d.y} x2={d.x - 4} y2={d.y + 11} />)}
        </g>
      )}
      {art.snow.map((d) => <circle key={d.key} cx={d.x} cy={d.y} r={d.r} fill="#fff" opacity="0.8" />)}
      {art.weather === 'thunderstorm' && <rect width={W} height={H} fill="#1b2030" opacity="0.25" />}
    </svg>
  );
}

function Pine({ x, y, s, color }) {
  return (
    <path
      d={`M${x} ${y - s * 2.6} L${x + s * 0.55} ${y - s * 1.5} L${x + s * 0.3} ${y - s * 1.5} L${x + s * 0.75} ${y - s * 0.6} L${x + s * 0.35} ${y - s * 0.6} L${x + s * 0.9} ${y} L${x - s * 0.9} ${y} L${x - s * 0.35} ${y - s * 0.6} L${x - s * 0.75} ${y - s * 0.6} L${x - s * 0.3} ${y - s * 1.5} L${x - s * 0.55} ${y - s * 1.5} Z`}
      fill={color}
    />
  );
}

// A bald cypress: a flared, buttressed trunk, a sparse flat-topped crown in a few clumps, and
// moss hanging from it.
function Cypress({ x, y, s, color }) {
  const clumps = [[-0.5, 2.05, 0.45, 0.15], [0.45, 2.25, 0.5, 0.16], [-0.08, 2.5, 0.55, 0.17], [0.15, 1.75, 0.35, 0.11]];
  return (
    <g fill={color} stroke={color}>
      <path d={`M${x - s * 0.38} ${y} Q${x - s * 0.12} ${y - s * 0.35} ${x - s * 0.08} ${y - s * 1.1} L${x - s * 0.05} ${y - s * 2.4} L${x + s * 0.05} ${y - s * 2.4} L${x + s * 0.08} ${y - s * 1.1} Q${x + s * 0.12} ${y - s * 0.35} ${x + s * 0.38} ${y} Z`} stroke="none" />
      {clumps.map(([dx, dy, rx, ry]) => (
        <g key={dx}>
          <line x1={x} y1={y - s * (dy - 0.3)} x2={x + s * dx} y2={y - s * dy} strokeWidth={Math.max(0.6, s * 0.05)} />
          <ellipse cx={x + s * dx} cy={y - s * dy} rx={s * rx} ry={s * ry} stroke="none" />
          {[-0.6, 0, 0.55].map((k) => (
            <line key={k} x1={x + s * (dx + k * rx)} x2={x + s * (dx + k * rx)} y1={y - s * dy} y2={y - s * (dy - 0.25 - Math.abs(k) * 0.15)} strokeWidth="0.7" strokeOpacity="0.7" />
          ))}
        </g>
      ))}
    </g>
  );
}

function Cactus({ x, y, s, color }) {
  return (
    <g stroke={color} strokeWidth={s * 0.22} strokeLinecap="round" fill="none">
      <line x1={x} y1={y} x2={x} y2={y - s * 2.2} />
      <path d={`M${x} ${y - s} H${x - s * 0.6} V${y - s * 1.7}`} />
      <path d={`M${x} ${y - s * 1.3} H${x + s * 0.55} V${y - s * 1.9}`} />
    </g>
  );
}

function Windmill({ x, y, color }) {
  return (
    <g stroke={color} strokeWidth="1.3" fill="none">
      <path d={`M${x - 8} ${y} L${x} ${y - 46} L${x + 8} ${y}`} />
      <line x1={x - 5} x2={x + 5} y1={y - 18} y2={y - 18} />
      <circle cx={x} cy={y - 48} r="11" />
      {[0, 45, 90, 135].map((a) => (
        <line key={a} x1={x} y1={y - 48} x2={x + 11 * Math.cos((a * Math.PI) / 180)} y2={y - 48 + 11 * Math.sin((a * Math.PI) / 180)} />
      ))}
    </g>
  );
}

function Building({ x, y, w, h, color, roof, lit, stilts = false }) {
  return (
    <g>
      {stilts && [0.15, 0.85].map((k) => <rect key={k} x={x + w * k - 1} y={y} width={2} height={12} fill={roof} />)}
      <rect x={x} y={y - h} width={w} height={h} fill={color} />
      <path d={`M${x - 3} ${y - h} L${x + w / 2} ${y - h - h * 0.6} L${x + w + 3} ${y - h} Z`} fill={roof} />
      <rect x={x + w * 0.3} y={y - h * 0.65} width={w * 0.18} height={h * 0.3} fill={lit ? '#ffc46b' : roof} opacity={lit ? 0.95 : 0.8} />
    </g>
  );
}

function Railway({ color }) {
  return (
    <g stroke={color} strokeWidth="1.2">
      <line x1="0" x2={W} y1={H * 0.74} y2={H * 0.72} />
      {[0.08, 0.3, 0.52, 0.74, 0.96].map((k) => (
        <g key={k}>
          <line x1={W * k} x2={W * k} y1={H * 0.73} y2={H * 0.5} />
          <line x1={W * k - 5} x2={W * k + 5} y1={H * 0.53} y2={H * 0.53} />
        </g>
      ))}
      <path d={`M0 ${H * 0.53} Q${W * 0.19} ${H * 0.57} ${W * 0.3} ${H * 0.53} T${W * 0.52} ${H * 0.53} T${W * 0.74} ${H * 0.53} T${W * 0.96} ${H * 0.53}`} fill="none" strokeWidth="0.6" />
    </g>
  );
}

const MemoScenery = memo(Scenery);
export default MemoScenery;

/**
 * The scenery with blended changes: a new hour, weather or place fades in over the last one
 * (about 1.6 s), which is then removed. Never more than two pictures at once; with reduced
 * motion the change is immediate.
 */
export function BlendedScenery(props) {
  const key = `${props.regionId}|${props.locationId}|${props.time}|${props.weather}`;
  const [shown, setShown] = useState(() => [{ key, props }]);
  if (shown[shown.length - 1].key !== key) setShown([...shown.slice(-1), { key, props }]);
  return (
    <div className={`fr-blend ${props.className || ''}`} aria-hidden="true">
      {shown.map((s, i) => (
        <div
          key={s.key}
          className={`fr-blend-layer${shown.length > 1 && i === shown.length - 1 ? ' is-in' : ''}`}
          onAnimationEnd={() => setShown((cur) => cur.slice(-1))}
        >
          <MemoScenery {...s.props} className="" />
        </div>
      ))}
    </div>
  );
}
