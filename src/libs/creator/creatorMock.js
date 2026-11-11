// DEVELOPMENT ONLY: stand-in answers for the creator API, so the widgets can be laid out and
// tested without Google or Meta credentials. Loaded only when `npm run dev` runs with
// VITE_CREATOR_MOCK=1 (creatorApi.js checks import.meta.env.DEV, which production builds
// replace with false, so this file is never part of a build). Every name here says "Sample".

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function seeded(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    return ((h >>> 0) % 10000) / 10000;
  };
}

function youtube(ref, mode, now) {
  const rand = seeded(ref);
  const subscribers = Math.round(20000 + rand() * 900000);
  const drift = Math.floor((now / 3600000) % 1000) * 7;
  const base = {
    platform: 'youtube',
    mode,
    fetchedAt: now,
    profile: { id: ref, name: `Sample Channel ${ref.slice(-3)}`, handle: `@sample${ref.slice(-3).toLowerCase()}`, avatar: null },
    stats: { subscribers: Number((subscribers + drift).toPrecision(3)), subscribersHidden: false, views: Math.round(subscribers * 140 + drift * 50), videos: Math.round(40 + rand() * 400) },
  };
  if (mode === 'public') return base;
  const end = new Date(now - 86400000).toISOString().slice(0, 10);
  const daily = Array.from({ length: 26 }, (_, i) => [new Date(now - (28 - i) * 86400000).toISOString().slice(0, 10), Math.round(8000 + rand() * 9000)]);
  const views = daily.reduce((sum, [, v]) => sum + v, 0);
  return {
    ...base,
    period: { start: new Date(now - 28 * 86400000).toISOString().slice(0, 10), end, days: 28, timeZone: 'America/Los_Angeles' },
    analytics: {
      status: 'ok',
      views,
      watchMinutes: Math.round(views * 3.4),
      avgViewDuration: 204,
      subscribersGained: Math.round(views / 90),
      subscribersLost: Math.round(views / 900),
      dataThrough: daily[daily.length - 1][0],
      daily,
    },
    revenue: { status: 'ok', amount: Math.round(views * 0.31 * 100) / 100, currency: 'INR' },
  };
}

export async function mockCall(op, { params = {}, body = null } = {}) {
  await delay(350);
  const now = Date.now();
  switch (op) {
    case 'config':
      return { youtube: { lookup: true, connect: true } };
    case 'channel': {
      const ref = `UCsample${String(params.q || 'x').replace(/[^A-Za-z0-9]/g, '').slice(0, 16).padEnd(16, '0')}`;
      return youtube(ref, 'public', now);
    }
    case 'authorize':
      return { url: `mock:${params.platform}` };
    case 'exchange': {
      const data = youtube('UCsampleOwnerChannel0000', 'owner', now);
      const scopes = { analytics: true, revenue: true };
      return { account: { platform: body.platform, ref: data.profile.id, mode: 'owner', profile: data.profile, scopes }, grant: `g1.sample-${body.platform}`, data };
    }
    case 'fetch':
      return { data: youtube('UCsampleOwnerChannel0000', 'owner', now) };
    case 'revoke':
      return { revoked: true };
    default:
      throw new Error(`Unknown mock op ${op}`);
  }
}
