import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  YT_SCOPES,
  _resetRateLimits,
  handleCallback,
  handleCreator,
  openGrant,
  pacificDay,
  rateLimit,
  sealGrant,
} from '../../../../api/_creatorProxy.js';

const KEY = 'k'.repeat(40);
const ENV = {
  YOUTUBE_API_KEY: 'yt-key-123',
  GOOGLE_CLIENT_ID: 'gid',
  GOOGLE_CLIENT_SECRET: 'gsecret',
  CREATOR_TOKEN_KEY: KEY,
  CREATOR_REDIRECT_URI: 'https://iweb.test/api/creator-callback',
};
const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const STATE = `web.${'s'.repeat(43)}`;
const VERIFIER = 'v'.repeat(64);

const reply = (status, body) => new Response(JSON.stringify(body), { status });
const request = (op, { method = 'GET', params = {}, body = null, origin = EXT, ip = '1.2.3.4' } = {}) => ({
  method,
  query: new URLSearchParams({ op, ...params }),
  body,
  origin,
  ip,
});
const parse = (result) => JSON.parse(result.body);

// A fake Google / Meta: routes by URL.
function upstreamFake(routes) {
  return vi.fn(async (url, init = {}) => {
    const u = String(url);
    for (const [match, handler] of routes) {
      if (u.includes(match)) return typeof handler === 'function' ? handler(u, init) : handler;
    }
    throw new Error(`unexpected upstream call ${u}`);
  });
}

const CHANNEL = {
  items: [{
    id: 'UC1234567890123456789012',
    snippet: { title: 'My Channel', customUrl: '@mine', thumbnails: { medium: { url: 'https://yt3.ggpht.com/a.jpg' } } },
    statistics: { subscriberCount: '12300', hiddenSubscriberCount: false, viewCount: '456789', videoCount: '42' },
  }],
};
const TOTALS = {
  columnHeaders: ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'subscribersGained', 'subscribersLost'].map((name) => ({ name, columnType: 'METRIC', dataType: 'INTEGER' })),
  rows: [[5000, 15000, 180, 120, 20]],
};
const DAILY = {
  columnHeaders: [{ name: 'day', columnType: 'DIMENSION', dataType: 'STRING' }, { name: 'views', columnType: 'METRIC', dataType: 'INTEGER' }],
  rows: [['2026-10-01', 100], ['2026-10-02', 140]],
};

function youtubeRoutes({ refresh = reply(200, { access_token: 'at' }), revenue = reply(200, { columnHeaders: [{ name: 'estimatedRevenue', columnType: 'METRIC', dataType: 'FLOAT' }], rows: [[12.5]] }) } = {}) {
  return upstreamFake([
    ['oauth2.googleapis.com/token', (u, init) => (String(init.body).includes('grant_type=refresh_token') ? refresh
      : reply(200, { access_token: 'at', refresh_token: 'rt-secret', scope: `${YT_SCOPES.channel} ${YT_SCOPES.revenue}` }))],
    ['youtube/v3/channels', reply(200, CHANNEL)],
    ['estimatedRevenue', revenue],
    ['dimensions=day', reply(200, DAILY)],
    ['youtubeanalytics', reply(200, TOTALS)],
    ['oauth2.googleapis.com/revoke', reply(200, {})],
  ]);
}

beforeEach(() => {
  _resetRateLimits();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('sealed grants', () => {
  it('round-trips, and rejects tampering, another platform or another key', () => {
    const sealed = sealGrant({ rt: 'secret-refresh' }, 'youtube', KEY);
    expect(sealed).not.toContain('secret-refresh');
    expect(openGrant(sealed, 'youtube', KEY).rt).toBe('secret-refresh');
    expect(openGrant(sealed, 'other', KEY)).toBeNull();
    expect(openGrant(sealed, 'youtube', 'x'.repeat(40))).toBeNull();
    const flipped = sealed.slice(0, -2) + (sealed.at(-2) === 'A' ? 'B' : 'A') + sealed.slice(-1);
    expect(openGrant(flipped, 'youtube', KEY)).toBeNull();
    expect(openGrant('nonsense', 'youtube', KEY)).toBeNull();
  });
});

describe('config', () => {
  it('reports what is set up', async () => {
    expect(parse(await handleCreator(request('config'), ENV))).toEqual({ youtube: { lookup: true, connect: true } });
    const bare = parse(await handleCreator(request('config'), { YOUTUBE_API_KEY: 'k' }));
    expect(bare).toEqual({ youtube: { lookup: true, connect: false } });
  });

  it('needs a long enough sealing key for sign-in', async () => {
    const weak = parse(await handleCreator(request('config'), { ...ENV, CREATOR_TOKEN_KEY: 'short' }));
    expect(weak.youtube.connect).toBe(false);
  });
});

describe('public channel lookup', () => {
  it('looks up a handle with forHandle and normalizes the channel', async () => {
    const fetchImpl = upstreamFake([['youtube/v3/channels', reply(200, CHANNEL)]]);
    const result = await handleCreator(request('channel', { params: { q: 'https://www.youtube.com/@mine/videos' } }), ENV, fetchImpl);
    expect(result.status).toBe(200);
    expect(fetchImpl.mock.calls[0][0]).toContain('forHandle=%40mine');
    const data = parse(result);
    expect(data).toMatchObject({ mode: 'public', profile: { id: 'UC1234567890123456789012', handle: '@mine' }, stats: { subscribers: 12300, views: 456789, videos: 42 } });
    expect(result.headers['cache-control']).toContain('s-maxage');
  });

  it('reports a missing channel, hidden counts and quota without leaking the key', async () => {
    let fetchImpl = upstreamFake([['youtube/v3/channels', reply(200, { items: [] })]]);
    let result = await handleCreator(request('channel', { params: { q: '@nobody' } }), ENV, fetchImpl);
    expect(result.status).toBe(404);
    expect(parse(result).error.code).toBe('NOT_FOUND');

    const hidden = structuredClone(CHANNEL);
    hidden.items[0].statistics.hiddenSubscriberCount = true;
    fetchImpl = upstreamFake([['youtube/v3/channels', reply(200, hidden)]]);
    _resetRateLimits();
    expect(parse(await handleCreator(request('channel', { params: { q: '@mine' } }), ENV, fetchImpl)).stats).toMatchObject({ subscribers: null, subscribersHidden: true });

    fetchImpl = upstreamFake([['youtube/v3/channels', reply(403, { error: { errors: [{ reason: 'quotaExceeded' }] } })]]);
    result = await handleCreator(request('channel', { params: { q: '@mine' } }), ENV, fetchImpl);
    expect(result.status).toBe(429);
    expect(parse(result).error.code).toBe('QUOTA');
    expect(result.body).not.toContain('yt-key-123');
  });

  it('rejects input that is not a channel, and says when lookup is not set up', async () => {
    expect((await handleCreator(request('channel', { params: { q: 'https://youtube.com/c/Name' } }), ENV, vi.fn())).status).toBe(400);
    const off = await handleCreator(request('channel', { params: { q: '@mine' } }), {}, vi.fn());
    expect(parse(off).error.code).toBe('NOT_CONFIGURED');
  });
});

describe('authorize', () => {
  const params = { platform: 'youtube', state: STATE, challenge: 'c'.repeat(43) };

  it('builds Google’s consent URL with PKCE and the minimum scopes', async () => {
    const url = new URL(parse(await handleCreator(request('authorize', { params }), ENV)).url);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('scope').split(' ')).toEqual([YT_SCOPES.channel, YT_SCOPES.analytics]);
    expect(url.searchParams.get('redirect_uri')).toBe(ENV.CREATOR_REDIRECT_URI);
    expect(url.toString()).not.toContain('gsecret');
  });

  it('asks for revenue reports only when asked', async () => {
    const url = new URL(parse(await handleCreator(request('authorize', { params: { ...params, revenue: '1' } }), ENV)).url);
    expect(url.searchParams.get('scope').split(' ')).toEqual([YT_SCOPES.channel, YT_SCOPES.revenue]);
  });

  it('rejects a malformed state or challenge, and unconfigured platforms', async () => {
    expect((await handleCreator(request('authorize', { params: { ...params, state: 'https://evil.example' } }), ENV)).status).toBe(400);
    expect((await handleCreator(request('authorize', { params: { ...params, challenge: 'short' } }), ENV)).status).toBe(400);
    expect(parse(await handleCreator(request('authorize', { params }), { YOUTUBE_API_KEY: 'k' })).error.code).toBe('NOT_CONFIGURED');
  });
});

describe('OAuth callback', () => {
  it('redirects an extension sign-in only to that extension’s chromiumapp.org address', () => {
    const state = `ext-abcdefghijklmnopabcdefghijklmnop.${'s'.repeat(43)}`;
    const result = handleCallback(new URLSearchParams({ code: 'abc', state }));
    expect(result.status).toBe(302);
    const location = new URL(result.headers.location);
    expect(location.origin).toBe('https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org');
    expect(location.searchParams.get('code')).toBe('abc');
    expect(location.searchParams.get('state')).toBe(state);
  });

  it('never redirects anywhere a state could name', () => {
    for (const state of ['https://evil.example', 'ext-EVIL.xyz', `ext-abc.evil.com.${'s'.repeat(43)}`, '']) {
      const result = handleCallback(new URLSearchParams({ code: 'abc', state }));
      expect(result.status).toBe(200);
      expect(result.headers.location).toBeUndefined();
      expect(result.body).not.toContain('<script>');
    }
  });

  it('hands a website sign-in to its own origin under a strict CSP, escaping the values', () => {
    const result = handleCallback(new URLSearchParams({ code: '</script><b>x', state: STATE }));
    expect(result.headers['content-security-policy']).toMatch(/default-src 'none'; .*script-src 'sha256-/);
    expect(result.body).not.toContain('</script><b>');
    expect(result.body).toContain('iweb-creator-auth');
  });

  it('passes a cancelled sign-in on as an error', () => {
    const state = `ext-abcdefghijklmnopabcdefghijklmnop.${'s'.repeat(43)}`;
    const location = new URL(handleCallback(new URLSearchParams({ error: 'access_denied', state })).headers.location);
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('code')).toBeNull();
  });
});

describe('YouTube owner', () => {
  it('exchanges a code: returns the account and data, and only a sealed grant', async () => {
    const fetchImpl = youtubeRoutes();
    const result = await handleCreator(request('exchange', { method: 'POST', body: { platform: 'youtube', code: 'c0de', verifier: VERIFIER, currency: 'INR' } }), ENV, fetchImpl);
    expect(result.status).toBe(200);
    expect(result.body).not.toContain('rt-secret');
    expect(result.body).not.toContain('"at"');
    const body = parse(result);
    expect(body.account).toMatchObject({ platform: 'youtube', ref: 'UC1234567890123456789012', mode: 'owner', scopes: { analytics: true, revenue: true } });
    expect(openGrant(body.grant, 'youtube', KEY).rt).toBe('rt-secret');
    expect(body.data.analytics).toMatchObject({ status: 'ok', views: 5000, watchMinutes: 15000, subscribersGained: 120, subscribersLost: 20, dataThrough: '2026-10-02' });
    expect(body.data.revenue).toEqual({ status: 'ok', amount: 12.5, currency: 'INR' });
    const tokenCall = fetchImpl.mock.calls.find(([u]) => String(u).includes('oauth2.googleapis.com/token'));
    expect(String(tokenCall[1].body)).toContain(`code_verifier=${VERIFIER}`);
  });

  it('rejects an exchange without a valid verifier', async () => {
    const result = await handleCreator(request('exchange', { method: 'POST', body: { platform: 'youtube', code: 'c0de', verifier: 'short' } }), ENV, vi.fn());
    expect(result.status).toBe(400);
  });

  it('marks revenue unavailable (not 0) when YouTube refuses it', async () => {
    const grant = sealGrant({ rt: 'rt', sc: [YT_SCOPES.channel, YT_SCOPES.revenue] }, 'youtube', KEY);
    const fetchImpl = youtubeRoutes({ revenue: reply(403, { error: { errors: [{ reason: 'forbidden' }] } }) });
    const body = parse(await handleCreator(request('fetch', { method: 'POST', body: { platform: 'youtube', grant, currency: 'USD' } }), ENV, fetchImpl));
    expect(body.data.revenue.status).toBe('unavailable');
    expect(body.data.revenue.amount).toBeUndefined();
    expect(body.data.analytics.status).toBe('ok');
  });

  it('never asks for revenue without the revenue scope', async () => {
    const grant = sealGrant({ rt: 'rt', sc: [YT_SCOPES.channel, YT_SCOPES.analytics] }, 'youtube', KEY);
    const fetchImpl = youtubeRoutes();
    const body = parse(await handleCreator(request('fetch', { method: 'POST', body: { platform: 'youtube', grant } }), ENV, fetchImpl));
    expect(body.data.revenue).toEqual({ status: 'not-authorized' });
    expect(fetchImpl.mock.calls.some(([u]) => String(u).includes('estimatedRevenue'))).toBe(false);
  });

  it('reports revoked access when Google refuses the refresh token', async () => {
    const grant = sealGrant({ rt: 'rt', sc: [] }, 'youtube', KEY);
    const fetchImpl = youtubeRoutes({ refresh: reply(400, { error: 'invalid_grant' }) });
    const result = await handleCreator(request('fetch', { method: 'POST', body: { platform: 'youtube', grant } }), ENV, fetchImpl);
    expect(result.status).toBe(401);
    expect(parse(result).error.code).toBe('REVOKED');
  });

  it('rejects a forged grant without calling Google', async () => {
    const fetchImpl = vi.fn();
    const result = await handleCreator(request('fetch', { method: 'POST', body: { platform: 'youtube', grant: 'g1.forged' } }), ENV, fetchImpl);
    expect(result.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('revokes with Google on disconnect', async () => {
    const grant = sealGrant({ rt: 'rt-x', sc: [] }, 'youtube', KEY);
    const fetchImpl = youtubeRoutes();
    expect(parse(await handleCreator(request('revoke', { method: 'POST', body: { platform: 'youtube', grant } }), ENV, fetchImpl))).toEqual({ revoked: true });
    expect(String(fetchImpl.mock.calls[0][1].body)).toBe('token=rt-x');
  });
});

describe('request checks', () => {
  it('refuses credentialed requests from other sites', async () => {
    const result = await handleCreator(request('fetch', { method: 'POST', body: { platform: 'youtube', grant: 'g1.x' }, origin: 'https://evil.example' }), ENV, vi.fn());
    expect(result.status).toBe(403);
    expect(result.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('allows the extension and iWeb’s own site', async () => {
    const own = await handleCreator(request('fetch', { method: 'OPTIONS', origin: 'https://iweb.test' }), ENV);
    expect(own.headers['Access-Control-Allow-Origin']).toBe('https://iweb.test');
    const ext = await handleCreator(request('fetch', { method: 'OPTIONS', origin: EXT }), ENV);
    expect(ext.headers['Access-Control-Allow-Origin']).toBe(EXT);
  });

  it('uses the right method per operation', async () => {
    expect((await handleCreator(request('fetch'), ENV)).status).toBe(405);
    expect((await handleCreator(request('channel', { method: 'POST' }), ENV)).status).toBe(405);
  });

  it('rate limits per client', () => {
    for (let i = 0; i < 60; i++) expect(rateLimit('lookup', '9.9.9.9', 1000)).toBe(0);
    expect(rateLimit('lookup', '9.9.9.9', 1000)).toBeGreaterThan(0);
    expect(rateLimit('lookup', '8.8.8.8', 1000)).toBe(0);
    expect(rateLimit('lookup', '9.9.9.9', 1000 + 11 * 60 * 1000)).toBe(0);
  });
});

describe('pacificDay', () => {
  it('counts days in Pacific Time', () => {
    // 2026-11-02 05:00 UTC is still 1 November in California.
    const now = Date.UTC(2026, 10, 2, 5);
    expect(pacificDay(now)).toBe('2026-11-01');
    expect(pacificDay(now, -28)).toBe('2026-10-04');
  });
});
