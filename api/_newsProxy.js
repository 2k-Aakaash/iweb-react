// Server-side news proxy, shared by the Vercel function (api/news.js) and the Vite dev-server
// middleware (vite.config.js).
//
// Source: Google News RSS (real-time, every publisher, no API key). Its feeds send no CORS
// headers, so the browser can't read them directly; this proxy fetches them server-side,
// parses the RSS, returns a compact normalized JSON shape and sets CDN cache headers so one
// upstream request serves every user for a while. Google's terms allow the feeds for personal,
// non-commercial use, credited to Google News and to each publisher (the UI shows both).
// The feeds carry no images and no article text: headline, publisher, time and links to
// other coverage of the same story.
// Files starting with "_" in /api are not deployed as their own Vercel functions.

const GOOGLE_NEWS = 'https://news.google.com/rss';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ARTICLES = 60;
const MAX_RELATED = 4;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;

// Google News sections → their RSS topic ids. Anything else is rejected.
export const TOPICS = ['WORLD', 'NATION', 'BUSINESS', 'TECHNOLOGY', 'ENTERTAINMENT', 'SPORTS', 'SCIENCE', 'HEALTH'];

// Supported editions: "<country>:<language>" → Google's hl / gl / ceid parameters.
export const EDITIONS = {
  'IN:en': { hl: 'en-IN', gl: 'IN', ceid: 'IN:en' },
  'IN:hi': { hl: 'hi', gl: 'IN', ceid: 'IN:hi' },
  'US:en': { hl: 'en-US', gl: 'US', ceid: 'US:en' },
  'GB:en': { hl: 'en-GB', gl: 'GB', ceid: 'GB:en' },
  'AU:en': { hl: 'en-AU', gl: 'AU', ceid: 'AU:en' },
  'CA:en': { hl: 'en-CA', gl: 'CA', ceid: 'CA:en' },
  'SG:en': { hl: 'en-SG', gl: 'SG', ceid: 'SG:en' },
};

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// Feeds change every few minutes; 15 minutes at the CDN keeps Google traffic tiny.
const CACHE_FEED = 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600';
const CACHE_SEARCH = 'public, max-age=600, s-maxage=1800, stale-while-revalidate=3600';

function json(status, body, cacheControl = 'no-store') {
  return {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': cacheControl, ...CORS_HEADERS },
    body: JSON.stringify(body),
  };
}

function error(status, code, message) {
  return json(status, { error: { code, message } });
}

// --- RSS parsing (Google News feeds are regular RSS 2.0; no XML library needed) -------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

// Text content of an element: CDATA unwrapped, tags removed, entities decoded, spaces tidied.
function textOf(raw) {
  if (raw == null) return '';
  const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decodeEntities(unwrapped.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function element(xml, tag) {
  const match = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return match ? { attrs: match[1] || '', body: match[2] } : null;
}

function attr(attrs, name) {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs || '');
  return match ? decodeEntities(match[1]) : null;
}

/** An absolute http(s) URL, or null. */
export function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

// The description holds the story cluster: <a href>headline</a> <font>source</font> per item.
function relatedCoverage(descriptionRaw, ownUrl) {
  const html = decodeEntities((descriptionRaw || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
  const out = [];
  const re = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>(?:\s|&nbsp;)*(?:<font[^>]*>([\s\S]*?)<\/font>)?/gi;
  let match;
  while ((match = re.exec(html)) && out.length < MAX_RELATED) {
    const url = safeUrl(decodeEntities(match[1]));
    const title = textOf(match[2]);
    if (!url || !title || url === ownUrl) continue;
    out.push({ title: title.slice(0, 300), url, sourceName: textOf(match[3] || '').slice(0, 80) || null });
  }
  return out;
}

/** Normalized articles from a Google News RSS document (unusable items are dropped). */
export function parseRss(xml) {
  const articles = [];
  const seen = new Set();
  const items = String(xml || '').match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const item of items) {
    if (articles.length >= MAX_ARTICLES) break;
    const url = safeUrl(textOf(element(item, 'link')?.body));
    const source = element(item, 'source');
    const sourceName = textOf(source?.body).slice(0, 80);
    let title = textOf(element(item, 'title')?.body);
    // Google appends " - Publisher" to every headline; the publisher is shown separately.
    if (sourceName && title.endsWith(` - ${sourceName}`)) title = title.slice(0, -(sourceName.length + 3)).trim();
    const published = Date.parse(textOf(element(item, 'pubDate')?.body));
    const guid = textOf(element(item, 'guid')?.body).replace(/[^\w-]/g, '').slice(0, 200);
    if (!url || !title || !Number.isFinite(published)) continue;
    const id = guid || url;
    if (seen.has(id)) continue;
    seen.add(id);
    const description = element(item, 'description');
    articles.push({
      id,
      title: title.slice(0, 300),
      url,
      sourceName: sourceName || 'Google News',
      sourceUrl: safeUrl(attr(source?.attrs, 'url')),
      publishedAt: new Date(published).toISOString(),
      related: relatedCoverage(description?.body, url),
    });
  }
  return articles;
}

// --- Upstream ---------------------------------------------------------------------------

async function fetchFeed(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'user-agent': USER_AGENT, accept: 'application/rss+xml, application/xml' } });
  } catch {
    return { failure: error(502, 'UNREACHABLE', 'Could not reach Google News.') };
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) return { failure: error(429, 'RATE_LIMITED', 'Google News is busy. Try again shortly.') };
  if (!res.ok) return { failure: error(502, 'UPSTREAM', `Google News answered ${res.status}.`) };
  const text = await res.text().catch(() => '');
  if (!text || text.length > MAX_BYTES || !/<rss[\s>]/i.test(text)) {
    return { failure: error(502, 'BAD_RESPONSE', 'Google News returned an unexpected response.') };
  }
  return { articles: parseRss(text) };
}

function editionParams(url, edition) {
  for (const [key, value] of Object.entries(EDITIONS[edition])) url.searchParams.set(key, value);
  return url;
}

/**
 * GET /api/news?op=feed&edition=IN:en[&topic=TECHNOLOGY]   → top stories, or a section
 * GET /api/news?op=search&edition=IN:en&q=chandrayaan       → search
 * @param {URLSearchParams} query
 */
export async function proxyNews(query) {
  const op = query.get('op');
  const edition = query.get('edition') || 'IN:en';
  if (!EDITIONS[edition]) return error(400, 'BAD_EDITION', 'Unknown edition.');

  if (op === 'feed') {
    const topic = query.get('topic');
    if (topic && !TOPICS.includes(topic)) return error(400, 'BAD_TOPIC', 'Unknown section.');
    const url = editionParams(new URL(topic ? `${GOOGLE_NEWS}/headlines/section/topic/${topic}` : GOOGLE_NEWS), edition);
    const { articles, failure } = await fetchFeed(url);
    if (failure) return failure;
    return json(200, { articles, fetchedAt: Date.now() }, CACHE_FEED);
  }

  if (op === 'search') {
    // Control characters out, spaces collapsed.
    const q = [...(query.get('q') || '')].filter((ch) => ch.charCodeAt(0) >= 32).join('').replace(/\s+/g, ' ').trim();
    if (q.length < MIN_QUERY_LENGTH || q.length > MAX_QUERY_LENGTH) return error(400, 'BAD_QUERY', 'Enter 2 to 100 characters.');
    const url = editionParams(new URL(`${GOOGLE_NEWS}/search`), edition);
    url.searchParams.set('q', q);
    const { articles, failure } = await fetchFeed(url);
    if (failure) return failure;
    return json(200, { articles, fetchedAt: Date.now() }, CACHE_SEARCH);
  }

  return error(400, 'BAD_OP', 'Unknown operation.');
}
