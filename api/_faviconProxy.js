// Server-side favicon proxy, shared by the Vercel function (api/favicon.js) and the Vite
// dev-server middleware (vite.config.js).
//
// GET /api/favicon?domain=example.com → the site's icon as an image, with CORS headers so the
// app can store the bytes in IndexedDB (favicon services don't send CORS headers), and a long
// CDN cache so one upstream fetch serves every user for a week.
//
// Sources, best first: Google's favicon service (sized), DuckDuckGo's, then the site's own
// /favicon.ico. Google answers unknown sites with a generic 16×16 globe, so tiny images are
// only used if nothing better turns up.
// Files starting with "_" in /api are not deployed as their own Vercel functions.

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const UPSTREAM_TIMEOUT_MS = 6000;
const MAX_BYTES = 512 * 1024;
const CACHE_HIT = 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800';
const CACHE_MISS = 'public, max-age=3600, s-maxage=86400';

// A bare hostname: labels of letters, digits and hyphens, at least one dot, no port or path.
const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function normalizeDomain(value) {
  const domain = String(value || '').trim().toLowerCase().replace(/^www\./, '');
  return DOMAIN_RE.test(domain) ? domain : null;
}

const sources = (domain) => [
  `https://www.google.com/s2/favicons?sz=128&domain_url=https://${domain}`,
  `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  `https://${domain}/favicon.ico`,
];

// Width of a PNG from its IHDR header (most favicon services return PNG), else null.
function pngWidth(bytes) {
  const isPng = bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  return isPng ? ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0 : null;
}

async function fetchImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!res.ok || !type.startsWith('image/') || type === 'image/svg+xml') return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_BYTES) return null;
    return { bytes, type };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {URLSearchParams} query
 * @returns {Promise<{ status: number, headers: Record<string,string>, body: string | Buffer }>}
 */
export async function proxyFavicon(query) {
  const domain = normalizeDomain(query.get('domain'));
  if (!domain) {
    return { status: 400, headers: { ...CORS_HEADERS, 'content-type': 'text/plain', 'cache-control': 'no-store' }, body: 'Invalid domain.' };
  }

  let fallback = null; // a tiny icon, kept in case nothing better exists
  for (const url of sources(domain)) {
    const image = await fetchImage(url);
    if (!image) continue;
    const width = pngWidth(image.bytes);
    if (width != null && width <= 16) {
      fallback ??= image;
      continue;
    }
    return ok(image, CACHE_HIT);
  }
  if (fallback) return ok(fallback, CACHE_HIT);
  return { status: 404, headers: { ...CORS_HEADERS, 'content-type': 'text/plain', 'cache-control': CACHE_MISS }, body: 'No favicon found.' };
}

function ok(image, cacheControl) {
  return {
    status: 200,
    headers: { ...CORS_HEADERS, 'content-type': image.type, 'cache-control': cacheControl },
    body: Buffer.from(image.bytes),
  };
}
