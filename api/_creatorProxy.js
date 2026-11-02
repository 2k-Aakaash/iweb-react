// Server side of the Creator widgets (YouTube Analytics, Instagram Analytics), shared by the
// Vercel functions (api/creator.js, api/creator-callback.js) and the Vite dev-server
// middleware (vite.config.js). See docs/CREATOR_WIDGETS.md.
//
// Why a server: the OAuth client secrets and the YouTube API key must never ship in the
// extension or the website, and Instagram's code exchange needs the app secret. The
// long-lived credential of a connected account (Google's refresh token, Instagram's
// long-lived token) is sealed here with AES-256-GCM (CREATOR_TOKEN_KEY): the browser stores
// only that sealed "grant", which it can't read or use against Google or Meta on its own.
// Every refresh sends the grant back here; this proxy opens it, calls the official APIs and
// returns the numbers. Stateless: nothing is stored here, and tokens are never logged or
// returned to the browser.
//
//   GET  ?op=config                         what this server has been set up for
//   GET  ?op=channel&q=                     public stats of a YouTube channel (CDN-cached)
//   GET  ?op=authorize&platform=&state=&challenge=[&revenue=1]   the consent page URL
//   POST ?op=exchange  { platform, code, verifier }     → { account, grant, data }
//   POST ?op=fetch     { platform, grant, currency }    → { data, grant? }
//   POST ?op=revoke    { platform, grant }              → { revoked }
//
// OAuth redirects come back to api/creator-callback.js (handleCallback below), which hands
// the code to the app that asked: the extension (via chrome.identity) or the website (via a
// BroadcastChannel on its own origin). The app checks `state` and holds the PKCE verifier.
// Files starting with "_" in /api are not deployed as their own Vercel functions.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { parseChannelInput } from '../src/libs/creator/channelInput.js';

const UPSTREAM_TIMEOUT_MS = 10000;
const MAX_BODY_BYTES = 16 * 1024;

const YT_API = 'https://www.googleapis.com/youtube/v3';
const YT_ANALYTICS = 'https://youtubeanalytics.googleapis.com/v2/reports';
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';
export const YT_SCOPES = {
  channel: 'https://www.googleapis.com/auth/youtube.readonly',
  analytics: 'https://www.googleapis.com/auth/yt-analytics.readonly',
  // Includes the non-monetary reports, so revenue replaces `analytics` rather than adding to it.
  revenue: 'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
};
// YouTube Analytics reports days in Pacific Time.
const YT_TIME_ZONE = 'America/Los_Angeles';
const PERIOD_DAYS = 28;

const IG_AUTH = 'https://www.instagram.com/oauth/authorize';
const IG_TOKEN = 'https://api.instagram.com/oauth/access_token';
const IG_GRAPH = 'https://graph.instagram.com';
// Graph API version for graph.instagram.com; INSTAGRAM_API_VERSION overrides it.
export const IG_VERSION = 'v25.0';
export const IG_SCOPES = ['instagram_business_basic', 'instagram_business_manage_insights'];
// Account insights over the period (metric_type=total_value). Each is optional: an account
// without one (fewer than 100 followers, a metric Meta retired) keeps the others, and the
// widget shows it as unavailable. `impressions` is not used: Meta retired it in April 2025.
export const IG_METRICS = ['reach', 'views', 'accounts_engaged', 'total_interactions', 'profile_views', 'profile_links_taps'];
const IG_ACCOUNT_TYPES = new Set(['BUSINESS', 'MEDIA_CREATOR']);
const IG_REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // renew the 60-day token weekly
const IG_RECENT_MEDIA = 4;

const CURRENCY_RE = /^[A-Z]{3}$/;
// state = "<target>.<random>"; the target says where the callback sends the code.
export const STATE_RE = /^(web|ext-[a-p]{32})\.[A-Za-z0-9_-]{32,128}$/;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43,128}$/;
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
const CODE_RE = /^[\x21-\x7e]{1,2048}$/;
const EXTENSION_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/;

// Public lookups change slowly (YouTube rounds subscriber counts): ten minutes at the CDN
// lets one YouTube request serve everyone looking at the same channel.
const CACHE_CHANNEL = 'public, max-age=300, s-maxage=600, stale-while-revalidate=1800';

// ---- configuration -------------------------------------------------------------------------

const text = (v) => (typeof v === 'string' ? v.trim() : '');

export function settingsFrom(env = {}) {
  const sealKey = text(env.CREATOR_TOKEN_KEY);
  const redirectUri = text(env.CREATOR_REDIRECT_URI);
  const oauthReady = sealKey.length >= 32 && /^https?:\/\//.test(redirectUri);
  return {
    youtubeKey: text(env.YOUTUBE_API_KEY),
    google: { id: text(env.GOOGLE_CLIENT_ID), secret: text(env.GOOGLE_CLIENT_SECRET) },
    instagram: { id: text(env.INSTAGRAM_APP_ID), secret: text(env.INSTAGRAM_APP_SECRET) },
    sealKey,
    redirectUri,
    oauthReady,
    igVersion: /^v\d+\.\d+$/.test(text(env.INSTAGRAM_API_VERSION)) ? text(env.INSTAGRAM_API_VERSION) : IG_VERSION,
    origins: text(env.CREATOR_ALLOWED_ORIGINS).split(',').map((o) => o.trim()).filter(Boolean),
  };
}

/** What the app may offer: public lookup, YouTube owner analytics, Instagram. */
export function configOf(s) {
  return {
    youtube: {
      lookup: Boolean(s.youtubeKey),
      connect: Boolean(s.oauthReady && s.google.id && s.google.secret),
    },
    instagram: {
      connect: Boolean(s.oauthReady && s.instagram.id && s.instagram.secret),
    },
  };
}

// ---- responses -----------------------------------------------------------------------------

/** CORS for a request: public GETs answer anyone; credentialed POSTs only iWeb's own pages. */
export function corsHeaders(origin, s, { open = false } = {}) {
  const base = { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', Vary: 'Origin' };
  if (open) return { ...base, 'Access-Control-Allow-Origin': '*' };
  if (origin && isAllowedOrigin(origin, s)) return { ...base, 'Access-Control-Allow-Origin': origin };
  return base;
}

function isAllowedOrigin(origin, s) {
  if (EXTENSION_ORIGIN_RE.test(origin)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  try {
    if (s.redirectUri && new URL(s.redirectUri).origin === origin) return true;
  } catch {
    // not a URL: ignored
  }
  return s.origins.includes(origin);
}

function json(status, body, headers = {}, cacheControl = 'no-store') {
  return {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': cacheControl, ...headers },
    body: JSON.stringify(body),
  };
}

function fail(status, code, message, headers = {}) {
  return json(status, { error: { code, message } }, headers);
}

class ProxyError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---- rate limiting -------------------------------------------------------------------------
// Per client IP, per function instance (best effort: Vercel runs several instances). It
// keeps one client from burning the shared YouTube quota; Google and Meta enforce their own
// limits per app and per user on top.

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMITS = { lookup: 60, auth: 30, data: 120 };
const hits = new Map();

export function rateLimit(bucket, ip, now = Date.now()) {
  const key = `${bucket}:${ip || 'unknown'}`;
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return 0;
  }
  entry.count += 1;
  return entry.count > RATE_LIMITS[bucket] ? Math.ceil((entry.resetAt - now) / 1000) : 0;
}

export function _resetRateLimits() {
  hits.clear();
}

// ---- sealed grants -------------------------------------------------------------------------

const keyOf = (secret) => createHash('sha256').update(secret).digest();
const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Encrypts a grant payload for the browser to keep (platform-bound). */
export function sealGrant(payload, platform, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(secret), iv);
  cipher.setAAD(Buffer.from(platform));
  const body = Buffer.concat([cipher.update(JSON.stringify({ ...payload, v: 1 }), 'utf8'), cipher.final()]);
  return `g1.${b64url(Buffer.concat([iv, cipher.getAuthTag(), body]))}`;
}

/** The payload of a sealed grant, or null if it was tampered with, is for another platform or another key. */
export function openGrant(sealed, platform, secret) {
  if (typeof sealed !== 'string' || !sealed.startsWith('g1.') || sealed.length > 8192) return null;
  try {
    const raw = Buffer.from(sealed.slice(3), 'base64url');
    if (raw.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', keyOf(secret), raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(platform));
    decipher.setAuthTag(raw.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    const payload = JSON.parse(plain);
    return payload?.v === 1 ? payload : null;
  } catch {
    return null;
  }
}

// ---- upstream ------------------------------------------------------------------------------

async function upstream(fetchImpl, url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    const raw = await res.text();
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch (err) {
    if (err?.name === 'AbortError') throw new ProxyError(504, 'TIMEOUT', 'The service took too long to answer. Try again.');
    throw new ProxyError(502, 'NETWORK', 'Couldn’t reach the service. Try again.');
  } finally {
    clearTimeout(timer);
  }
}

const form = (fields) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});

const num = (v) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : null);

function httpsImage(url) {
  if (typeof url !== 'string' || url.length > 2048) return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

// ---- YouTube -------------------------------------------------------------------------------

// Google API errors → codes the app understands (never Google's raw message with keys).
function googleError(status, body, what) {
  const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || '';
  if (/quota|dailyLimit|rateLimit/i.test(reason) || status === 429) {
    return new ProxyError(429, 'QUOTA', 'YouTube’s daily request limit for iWeb has been reached. It resets at midnight Pacific Time.');
  }
  if (status === 401) return new ProxyError(401, 'REVOKED', 'Access to this channel has expired or was removed. Connect it again.');
  if (status === 403) return new ProxyError(403, 'PERMISSION', `YouTube didn’t allow access to ${what}.`);
  if (status === 404) return new ProxyError(404, 'NOT_FOUND', 'YouTube couldn’t find that channel.');
  return new ProxyError(502, 'UPSTREAM', `YouTube couldn’t return ${what} right now.`);
}

function normalizeChannel(item) {
  const sn = item.snippet || {};
  const st = item.statistics || {};
  const thumbs = sn.thumbnails || {};
  const hidden = Boolean(st.hiddenSubscriberCount);
  return {
    profile: {
      id: str(item.id, 64),
      name: str(sn.title) || 'YouTube channel',
      handle: str(sn.customUrl, 64),
      avatar: httpsImage(thumbs.medium?.url || thumbs.default?.url),
    },
    stats: {
      subscribers: hidden ? null : num(st.subscriberCount),
      subscribersHidden: hidden,
      views: num(st.viewCount),
      videos: num(st.videoCount),
    },
  };
}

async function youtubeChannel(fetchImpl, params, auth) {
  const url = `${YT_API}/channels?${new URLSearchParams({ part: 'snippet,statistics', ...params })}`;
  const { status, body } = await upstream(fetchImpl, url, auth ? { headers: { authorization: `Bearer ${auth}` } } : {});
  if (status !== 200) throw googleError(status, body, 'this channel');
  const item = body?.items?.[0];
  return item ? normalizeChannel(item) : null;
}

export async function lookupChannel(q, s, fetchImpl) {
  const parsed = parseChannelInput(q);
  if (parsed.error) throw new ProxyError(400, 'BAD_REQUEST', parsed.error);
  const param = { id: 'id', handle: 'forHandle', username: 'forUsername' }[parsed.kind];
  const channel = await youtubeChannel(fetchImpl, { [param]: parsed.value, key: s.youtubeKey });
  if (!channel) throw new ProxyError(404, 'NOT_FOUND', `No YouTube channel matches “${parsed.value}”. It may have been renamed, deleted or made private.`);
  return { platform: 'youtube', mode: 'public', fetchedAt: Date.now(), ...channel };
}

// A day in Pacific Time as YYYY-MM-DD, `offset` days from `now`.
export function pacificDay(now, offset = 0) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: YT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
}

async function analyticsReport(fetchImpl, token, params) {
  const url = `${YT_ANALYTICS}?${new URLSearchParams({ ids: 'channel==MINE', ...params })}`;
  return upstream(fetchImpl, url, { headers: { authorization: `Bearer ${token}` } });
}

// One row of a report as { column: value }.
function rowOf(body, row) {
  const out = {};
  (body?.columnHeaders || []).forEach((h, i) => {
    out[h.name] = h.dataType === 'STRING' || h.columnType === 'DIMENSION' ? row[i] : num(row[i]);
  });
  return out;
}

/** The channel's stats and its owner-only analytics over the last 28 complete days. */
export async function youtubeOwnerData(fetchImpl, token, { scopes, currency }, now = Date.now()) {
  const channel = await youtubeChannel(fetchImpl, { mine: 'true' }, token);
  if (!channel) throw new ProxyError(422, 'NO_CHANNEL', 'This Google account has no YouTube channel.');

  // The last 28 days up to yesterday (Pacific Time). YouTube can take two or three days to
  // finish a day's numbers, so the most recent days may still rise.
  const period = { start: pacificDay(now, -PERIOD_DAYS), end: pacificDay(now, -1), days: PERIOD_DAYS, timeZone: YT_TIME_ZONE };
  const range = { startDate: period.start, endDate: period.end };
  const canRevenue = scopes.includes(YT_SCOPES.revenue);
  const [totals, daily, revenue] = await Promise.all([
    analyticsReport(fetchImpl, token, { ...range, metrics: 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost' }),
    analyticsReport(fetchImpl, token, { ...range, metrics: 'views', dimensions: 'day', sort: 'day' }),
    canRevenue
      ? analyticsReport(fetchImpl, token, { ...range, metrics: 'estimatedRevenue', currency: CURRENCY_RE.test(currency) ? currency : 'USD' })
      : null,
  ]);

  let analytics;
  if (totals.status === 200) {
    const row = totals.body?.rows?.[0] ? rowOf(totals.body, totals.body.rows[0]) : {};
    analytics = {
      status: 'ok',
      // No row: no activity in the period, which YouTube reports as an empty table.
      views: row.views ?? (totals.body?.rows ? null : 0),
      watchMinutes: row.estimatedMinutesWatched ?? (totals.body?.rows ? null : 0),
      avgViewDuration: row.averageViewDuration ?? null,
      subscribersGained: row.subscribersGained ?? (totals.body?.rows ? null : 0),
      subscribersLost: row.subscribersLost ?? (totals.body?.rows ? null : 0),
      // YouTube reports up to the last day it has finished (48–72 hours behind).
      dataThrough: null,
      daily: daily.status === 200
        ? (daily.body?.rows || []).map((r) => rowOf(daily.body, r)).filter((r) => r.day && r.views !== null).map((r) => [r.day, r.views])
        : [],
    };
    analytics.dataThrough = analytics.daily.length ? analytics.daily[analytics.daily.length - 1][0] : null;
  } else {
    const err = googleError(totals.status, totals.body, 'this channel’s analytics');
    if (err.code === 'REVOKED' || err.code === 'QUOTA') throw err;
    analytics = { status: 'unavailable', code: err.code, message: err.message };
  }

  let revenueData = { status: 'not-authorized' };
  if (revenue) {
    if (revenue.status === 200) {
      const row = revenue.body?.rows?.[0] ? rowOf(revenue.body, revenue.body.rows[0]) : null;
      const amount = row ? row.estimatedRevenue : 0;
      revenueData = amount === null
        ? { status: 'unavailable', message: 'YouTube didn’t report revenue for this period.' }
        : { status: 'ok', amount, currency: CURRENCY_RE.test(currency) ? currency : 'USD' };
    } else {
      revenueData = {
        status: 'unavailable',
        message: revenue.status === 403
          ? 'YouTube doesn’t share revenue for this channel (it may not be in the YouTube Partner Program).'
          : 'YouTube couldn’t return revenue right now.',
      };
    }
  }

  return { platform: 'youtube', mode: 'owner', fetchedAt: now, ...channel, period, analytics, revenue: revenueData };
}

async function googleRefresh(fetchImpl, s, refreshToken) {
  const { status, body } = await upstream(fetchImpl, GOOGLE_TOKEN, form({
    client_id: s.google.id,
    client_secret: s.google.secret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }));
  if (status === 200 && body?.access_token) return body.access_token;
  if (body?.error === 'invalid_grant') throw new ProxyError(401, 'REVOKED', 'Access to this channel has expired or was removed. Connect it again.');
  throw new ProxyError(502, 'UPSTREAM', 'Google couldn’t renew access right now. Try again.');
}

async function youtubeExchange(body, s, fetchImpl) {
  const { status, body: token } = await upstream(fetchImpl, GOOGLE_TOKEN, form({
    code: body.code,
    client_id: s.google.id,
    client_secret: s.google.secret,
    redirect_uri: s.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: body.verifier,
  }));
  if (status !== 200 || !token?.access_token) {
    throw new ProxyError(400, 'AUTH_FAILED', 'Google didn’t accept the sign-in. Try connecting again.');
  }
  const scopes = String(token.scope || '').split(/\s+/).filter(Boolean);
  if (!scopes.includes(YT_SCOPES.channel) || !(scopes.includes(YT_SCOPES.analytics) || scopes.includes(YT_SCOPES.revenue))) {
    throw new ProxyError(403, 'PERMISSION', 'iWeb needs permission to view your channel and its analytics. Connect again and allow both.');
  }
  if (!token.refresh_token) {
    throw new ProxyError(400, 'AUTH_FAILED', 'Google didn’t grant lasting access. Remove iWeb at myaccount.google.com/permissions, then connect again.');
  }
  const data = await youtubeOwnerData(fetchImpl, token.access_token, { scopes, currency: body.currency });
  const grant = sealGrant({ rt: token.refresh_token, sc: scopes, cid: data.profile.id }, 'youtube', s.sealKey);
  return { account: accountOf(data, scopes), grant, data };
}

function accountOf(data, scopes = []) {
  return {
    platform: data.platform,
    ref: data.profile.id,
    mode: data.mode,
    profile: data.profile,
    scopes: data.platform === 'youtube'
      ? { analytics: scopes.includes(YT_SCOPES.analytics) || scopes.includes(YT_SCOPES.revenue), revenue: scopes.includes(YT_SCOPES.revenue) }
      : { insights: scopes.includes('instagram_business_manage_insights') },
  };
}

// ---- Instagram -----------------------------------------------------------------------------

function instagramError(status, body, what) {
  const e = body?.error || {};
  if (status === 429 || [4, 17, 32, 613].includes(e.code)) {
    return new ProxyError(429, 'RATE_LIMITED', 'Instagram is limiting requests right now. iWeb will try again later.');
  }
  if (e.code === 190 || status === 401) return new ProxyError(401, 'REVOKED', 'Access to this Instagram account has expired or was removed. Connect it again.');
  if (e.code === 10 || e.code === 200 || status === 403) return new ProxyError(403, 'PERMISSION', `Instagram didn’t allow access to ${what}.`);
  if (e.code === 100) return new ProxyError(400, 'UNAVAILABLE', `Instagram doesn’t provide ${what} for this account.`);
  return new ProxyError(502, 'UPSTREAM', `Instagram couldn’t return ${what} right now.`);
}

let igVersion = IG_VERSION;
const igUrl = (path, params) => `${IG_GRAPH}/${igVersion}/${path}?${new URLSearchParams(params)}`;

const PROFILE_FIELDS = 'username,name,profile_picture_url,followers_count,follows_count,media_count';

async function instagramProfile(fetchImpl, token) {
  let { status, body } = await upstream(fetchImpl, igUrl('me', { fields: `user_id,account_type,${PROFILE_FIELDS}`, access_token: token }));
  // A field this API version doesn't know fails the whole request: ask for the core fields.
  if (status !== 200 && body?.error?.code === 100) {
    ({ status, body } = await upstream(fetchImpl, igUrl('me', { fields: `id,${PROFILE_FIELDS}`, access_token: token })));
  }
  if (status !== 200 || !body) throw instagramError(status, body, 'this account');
  // Instagram Login only lets professional accounts in; the type is checked when reported.
  if (body.account_type && !IG_ACCOUNT_TYPES.has(body.account_type)) {
    throw new ProxyError(422, 'UNSUPPORTED_ACCOUNT', 'Only Instagram Business and Creator accounts can be connected. Switch to a professional account in Instagram’s settings, then try again.');
  }
  return {
    profile: {
      id: str(String(body.user_id ?? body.id ?? ''), 64),
      name: str(body.name) || str(body.username),
      handle: body.username ? `@${str(body.username, 64)}` : null,
      avatar: httpsImage(body.profile_picture_url),
      accountType: body.account_type === 'MEDIA_CREATOR' ? 'Creator' : body.account_type === 'BUSINESS' ? 'Business' : 'Professional',
    },
    stats: { followers: num(body.followers_count), following: num(body.follows_count), media: num(body.media_count) },
  };
}

async function instagramInsights(fetchImpl, token, since, until) {
  const request = (metrics) => upstream(fetchImpl, igUrl('me/insights', {
    metric: metrics.join(','),
    period: 'day',
    metric_type: 'total_value',
    since: String(since),
    until: String(until),
    access_token: token,
  }));
  const read = (body) => {
    const out = {};
    for (const entry of body?.data || []) {
      const value = num(entry?.total_value?.value);
      if (IG_METRICS.includes(entry?.name) && value !== null) out[entry.name] = value;
    }
    return out;
  };
  const all = await request(IG_METRICS);
  if (all.status === 200) return { values: read(all.body), unavailable: IG_METRICS.filter((m) => !(m in read(all.body))) };
  const err = instagramError(all.status, all.body, 'insights');
  if (err.code !== 'UNAVAILABLE') throw err;
  // One metric Instagram won't give this account fails the whole request: ask one by one.
  const each = await Promise.all(IG_METRICS.map((m) => request([m])));
  const values = {};
  each.forEach((r) => {
    if (r.status === 200) Object.assign(values, read(r.body));
  });
  return { values, unavailable: IG_METRICS.filter((m) => !(m in values)) };
}

async function instagramMedia(fetchImpl, token) {
  const request = (extra) => upstream(fetchImpl, igUrl('me/media', {
    fields: `id,media_type,${extra}timestamp,permalink,like_count,comments_count`,
    limit: String(IG_RECENT_MEDIA),
    access_token: token,
  }));
  let { status, body } = await request('media_product_type,');
  if (status !== 200 && body?.error?.code === 100) ({ status, body } = await request(''));
  if (status !== 200) return null;
  return (body?.data || []).slice(0, IG_RECENT_MEDIA).map((m) => ({
    id: str(String(m.id), 64),
    type: m.media_product_type === 'REELS' ? 'Reel' : m.media_type === 'CAROUSEL_ALBUM' ? 'Carousel' : m.media_type === 'VIDEO' ? 'Video' : 'Photo',
    at: Date.parse(m.timestamp) || null,
    url: typeof m.permalink === 'string' && m.permalink.startsWith('https://www.instagram.com/') ? m.permalink : null,
    likes: num(m.like_count),
    comments: num(m.comments_count),
  }));
}

/** Profile, the last 28 days of account insights and recent posts. */
export async function instagramData(fetchImpl, token, now = Date.now()) {
  const until = Math.floor(now / 1000);
  const since = until - PERIOD_DAYS * 24 * 60 * 60;
  const account = await instagramProfile(fetchImpl, token);
  const [insights, media] = await Promise.all([
    instagramInsights(fetchImpl, token, since, until).then(
      (r) => ({ status: 'ok', ...r }),
      (err) => {
        if (err.code === 'REVOKED' || err.code === 'RATE_LIMITED') throw err;
        return { status: 'unavailable', code: err.code, message: err.message, values: {}, unavailable: IG_METRICS };
      },
    ),
    instagramMedia(fetchImpl, token),
  ]);
  return {
    platform: 'instagram',
    mode: 'owner',
    fetchedAt: now,
    ...account,
    period: { start: new Date(since * 1000).toISOString(), end: new Date(until * 1000).toISOString(), days: PERIOD_DAYS },
    insights,
    media,
  };
}

async function instagramExchange(body, s, fetchImpl) {
  const short = await upstream(fetchImpl, IG_TOKEN, form({
    client_id: s.instagram.id,
    client_secret: s.instagram.secret,
    grant_type: 'authorization_code',
    redirect_uri: s.redirectUri,
    code: body.code,
  }));
  // Answered as { access_token, user_id, permissions } or wrapped in data: [ … ].
  const shortToken = short.body?.access_token || short.body?.data?.[0]?.access_token;
  if (short.status !== 200 || !shortToken) {
    throw new ProxyError(400, 'AUTH_FAILED', 'Instagram didn’t accept the sign-in. Try connecting again.');
  }
  const rawPermissions = short.body?.permissions ?? short.body?.data?.[0]?.permissions ?? '';
  const permissions = Array.isArray(rawPermissions) ? rawPermissions : String(rawPermissions).split(',').map((p) => p.trim()).filter(Boolean);
  const long = await upstream(fetchImpl, `${IG_GRAPH}/access_token?${new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: s.instagram.secret,
    access_token: shortToken,
  })}`);
  if (long.status !== 200 || !long.body?.access_token) throw instagramError(long.status, long.body, 'lasting access');
  const now = Date.now();
  const token = long.body.access_token;
  const data = await instagramData(fetchImpl, token, now);
  const grant = sealGrant({ t: token, iat: now, exp: now + (num(long.body.expires_in) || 0) * 1000, uid: data.profile.id }, 'instagram', s.sealKey);
  return { account: accountOf(data, permissions.length ? permissions : IG_SCOPES), grant, data };
}

async function instagramRenew(fetchImpl, payload, s, now) {
  if (now - payload.iat < IG_REFRESH_AFTER_MS) return null;
  const { status, body } = await upstream(fetchImpl, `${IG_GRAPH}/refresh_access_token?${new URLSearchParams({
    grant_type: 'ig_refresh_token',
    access_token: payload.t,
  })}`);
  if (status !== 200 || !body?.access_token) return null; // keep the current token; try next time
  return { ...payload, t: body.access_token, iat: now, exp: now + (num(body.expires_in) || 0) * 1000 };
}

// ---- operations ----------------------------------------------------------------------------

function requirePlatform(platform) {
  if (platform !== 'youtube' && platform !== 'instagram') throw new ProxyError(400, 'BAD_REQUEST', 'Unknown platform.');
}

function requireConnect(platform, s) {
  const config = configOf(s);
  if (!config[platform].connect) {
    throw new ProxyError(503, 'NOT_CONFIGURED', `${platform === 'youtube' ? 'YouTube' : 'Instagram'} sign-in isn’t set up on this iWeb server.`);
  }
}

export function authorizeUrl(query, s) {
  const platform = query.get('platform');
  requirePlatform(platform);
  requireConnect(platform, s);
  const state = query.get('state') || '';
  const challenge = query.get('challenge') || '';
  if (!STATE_RE.test(state) || !CHALLENGE_RE.test(challenge)) throw new ProxyError(400, 'BAD_REQUEST', 'Invalid sign-in request.');
  if (platform === 'youtube') {
    const scopes = [YT_SCOPES.channel, query.get('revenue') === '1' ? YT_SCOPES.revenue : YT_SCOPES.analytics];
    return `${GOOGLE_AUTH}?${new URLSearchParams({
      client_id: s.google.id,
      redirect_uri: s.redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      // consent: a refresh token every time; select_account: pick the channel's account.
      prompt: 'consent select_account',
      include_granted_scopes: 'false',
    })}`;
  }
  return `${IG_AUTH}?${new URLSearchParams({
    client_id: s.instagram.id,
    redirect_uri: s.redirectUri,
    response_type: 'code',
    scope: IG_SCOPES.join(','),
    state,
  })}`;
}

async function fetchData(body, s, fetchImpl) {
  requirePlatform(body.platform);
  requireConnect(body.platform, s);
  const payload = openGrant(body.grant, body.platform, s.sealKey);
  if (!payload) throw new ProxyError(401, 'REVOKED', 'This connection is no longer valid. Connect the account again.');
  const now = Date.now();
  if (body.platform === 'youtube') {
    const token = await googleRefresh(fetchImpl, s, payload.rt);
    return { data: await youtubeOwnerData(fetchImpl, token, { scopes: payload.sc || [], currency: body.currency }, now) };
  }
  if (payload.exp && payload.exp <= now) throw new ProxyError(401, 'REVOKED', 'Access to this Instagram account has expired. Connect it again.');
  const renewed = await instagramRenew(fetchImpl, payload, s, now);
  const data = await instagramData(fetchImpl, (renewed || payload).t, now);
  return { data, ...(renewed ? { grant: sealGrant(renewed, 'instagram', s.sealKey) } : null) };
}

async function revoke(body, s, fetchImpl) {
  requirePlatform(body.platform);
  const payload = s.sealKey.length >= 32 ? openGrant(body.grant, body.platform, s.sealKey) : null;
  if (!payload) return { revoked: false };
  if (body.platform === 'youtube') {
    const { status } = await upstream(fetchImpl, GOOGLE_REVOKE, form({ token: payload.rt }));
    return { revoked: status === 200 };
  }
  // Instagram has no endpoint to revoke a token: the person removes iWeb in Instagram.
  return { revoked: false, manual: true };
}

function validExchange(body) {
  return body && typeof body.code === 'string' && CODE_RE.test(body.code)
    && (body.platform === 'instagram' || (typeof body.verifier === 'string' && VERIFIER_RE.test(body.verifier)));
}

/**
 * Handles one API request. `req`: { method, query (URLSearchParams), body (parsed JSON or
 * null), origin, ip }. Returns { status, headers, body }.
 */
export async function handleCreator(req, env, fetchImpl = fetch) {
  const s = settingsFrom(env);
  igVersion = s.igVersion;
  const op = req.query.get('op') || '';
  const isPost = ['exchange', 'fetch', 'revoke'].includes(op);
  const cors = corsHeaders(req.origin, s, { open: !isPost });

  if (req.method === 'OPTIONS') return { status: 204, headers: cors, body: '' };
  if (req.method !== (isPost ? 'POST' : 'GET')) return fail(405, 'METHOD', 'Method not allowed.', { ...cors, Allow: isPost ? 'POST, OPTIONS' : 'GET, OPTIONS' });
  if (isPost && req.origin && !cors['Access-Control-Allow-Origin']) return fail(403, 'ORIGIN', 'Requests from this site aren’t accepted.', cors);

  const bucket = op === 'channel' ? 'lookup' : op === 'authorize' || op === 'exchange' ? 'auth' : 'data';
  const wait = op === 'config' ? 0 : rateLimit(bucket, req.ip);
  if (wait) return fail(429, 'RATE_LIMITED', 'Too many requests. Try again in a few minutes.', { ...cors, 'Retry-After': String(wait) });

  try {
    switch (op) {
      case 'config':
        return json(200, configOf(s), cors, 'public, max-age=300, s-maxage=300');
      case 'channel':
        if (!s.youtubeKey) throw new ProxyError(503, 'NOT_CONFIGURED', 'YouTube channel lookup isn’t set up on this iWeb server.');
        return json(200, await lookupChannel(req.query.get('q'), s, fetchImpl), cors, CACHE_CHANNEL);
      case 'authorize':
        return json(200, { url: authorizeUrl(req.query, s) }, cors);
      case 'exchange': {
        if (!validExchange(req.body)) throw new ProxyError(400, 'BAD_REQUEST', 'Invalid sign-in response.');
        requirePlatform(req.body.platform);
        requireConnect(req.body.platform, s);
        const result = req.body.platform === 'youtube'
          ? await youtubeExchange(req.body, s, fetchImpl)
          : await instagramExchange(req.body, s, fetchImpl);
        return json(200, result, cors);
      }
      case 'fetch':
        if (!req.body || typeof req.body.grant !== 'string') throw new ProxyError(400, 'BAD_REQUEST', 'Missing account.');
        return json(200, await fetchData(req.body, s, fetchImpl), cors);
      case 'revoke':
        if (!req.body || typeof req.body.grant !== 'string') throw new ProxyError(400, 'BAD_REQUEST', 'Missing account.');
        return json(200, await revoke(req.body, s, fetchImpl), cors);
      default:
        return fail(400, 'BAD_REQUEST', 'Unknown operation.', cors);
    }
  } catch (err) {
    if (err instanceof ProxyError) {
      const extra = err.status === 429 ? { 'Retry-After': '3600' } : {};
      return fail(err.status, err.code, err.message, { ...cors, ...extra });
    }
    // Never log request bodies: they carry grants.
    console.error('[creator] unexpected failure in', op, err?.name || 'Error');
    return fail(500, 'INTERNAL', 'Something went wrong. Try again.', cors);
  }
}

/** Reads a JSON request body (Vercel may have parsed it already). Null if absent or invalid. */
export async function readJsonBody(req) {
  if (req.method !== 'POST') return null;
  if (req.body !== undefined) {
    if (typeof req.body === 'object') return req.body;
    try {
      return JSON.parse(String(req.body));
    } catch {
      return null;
    }
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

export function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

// ---- OAuth callback ------------------------------------------------------------------------

const htmlEscape = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function callbackPage(message, payload) {
  // The website listens on its own origin (creatorAuth.js); the extension never gets here.
  const script = payload
    ? `(()=>{const m=${JSON.stringify(payload).replace(/</g, '\\u003c')};`
      + 'try{const c=new BroadcastChannel("iweb-creator-auth");c.postMessage(m);c.close();}catch(e){}'
      + 'try{localStorage.setItem("iweb:creatorAuthResult",JSON.stringify(Object.assign({at:Date.now()},m)));}catch(e){}'
      + 'setTimeout(()=>window.close(),300);})();'
    : '';
  const hash = createHash('sha256').update(script).digest('base64');
  return {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'`,
    },
    body: '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
      + '<title>iWeb</title><body style="font:15px system-ui,sans-serif;background:#1c1c1e;color:#f2f2f7;display:grid;place-items:center;height:100vh;margin:0">'
      + `<p>${htmlEscape(message)}</p>${script ? `<script>${script}</script>` : ''}</body></html>`,
  };
}

/**
 * The OAuth redirect (api/creator-callback.js): sends the code and state on to the app that
 * started sign-in. Only two destinations exist: an extension's own chromiumapp.org address
 * (taken from `state`, so never an arbitrary URL) or this site's page script.
 */
export function handleCallback(query) {
  const state = query.get('state') || '';
  if (!STATE_RE.test(state)) return callbackPage('This sign-in link is invalid or has expired. Close this window and try again from iWeb.');
  const code = query.get('code') || '';
  const errorCode = (query.get('error') || '').replace(/[^a-z_]/gi, '').slice(0, 64);
  const result = code && CODE_RE.test(code) ? { code, state } : { error: errorCode || 'invalid_request', state };
  const target = state.split('.')[0];
  if (target.startsWith('ext-')) {
    const location = `https://${target.slice(4)}.chromiumapp.org/creator-auth?${new URLSearchParams(result)}`;
    return { status: 302, headers: { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }, body: '' };
  }
  return callbackPage(result.code ? 'Connected. You can close this window.' : 'Sign-in was cancelled. You can close this window.', { type: 'iweb-creator-auth', ...result });
}
