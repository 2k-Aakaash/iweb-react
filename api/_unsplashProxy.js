// Server-side Unsplash proxy logic, shared by the Vercel function (api/unsplash.js)
// and the Vite dev-server middleware (vite.config.js). The Access Key only ever
// lives on the server (env UNSPLASH_ACCESS_KEY); the browser never sees it.
// Files starting with "_" in /api are not deployed as their own Vercel functions.

const UNSPLASH_API = 'https://api.unsplash.com';

// Only the endpoints the wallpaper feature uses.
const ALLOWED_PATHS = [
  /^\/photos\/random$/,
  /^\/search\/photos$/,
  /^\/photos\/[A-Za-z0-9_-]{1,64}\/download$/,
];

const PASSTHROUGH_HEADERS = ['content-type', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'retry-after'];

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Expose-Headers': 'X-Ratelimit-Limit, X-Ratelimit-Remaining, Retry-After',
};

function json(status, body) {
  return {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify(body),
  };
}

/**
 * @param {URLSearchParams} query  incoming query; `path` selects the Unsplash endpoint,
 *                                  every other param is forwarded.
 * @param {string} accessKey
 * @returns {Promise<{ status: number, headers: Record<string,string>, body: string }>}
 */
export async function proxyUnsplash(query, accessKey) {
  if (!accessKey) return json(500, { errors: ['Unsplash proxy is not configured (UNSPLASH_ACCESS_KEY missing).'] });

  const path = query.get('path') || '';
  if (!ALLOWED_PATHS.some((re) => re.test(path))) {
    return json(400, { errors: ['Unsupported Unsplash endpoint.'] });
  }

  const target = new URL(path, UNSPLASH_API);
  for (const [key, value] of query) {
    if (key !== 'path') target.searchParams.append(key, value);
  }

  let upstream;
  try {
    upstream = await fetch(target, {
      headers: { Authorization: `Client-ID ${accessKey}`, 'Accept-Version': 'v1' },
    });
  } catch {
    return json(502, { errors: ['Could not reach Unsplash.'] });
  }

  const headers = { ...CORS_HEADERS, 'cache-control': 'no-store' };
  for (const name of PASSTHROUGH_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  return { status: upstream.status, headers, body: await upstream.text() };
}
