// Vercel serverless function: GET /api/favicon?domain=example.com
// Returns the site's favicon with CORS + a week of CDN cache; see _faviconProxy.js.

import { CORS_HEADERS, proxyFavicon } from './_faviconProxy.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS).end();
    return;
  }
  if (req.method !== 'GET') {
    res.writeHead(405, { ...CORS_HEADERS, Allow: 'GET, OPTIONS' }).end();
    return;
  }

  const query = new URL(req.url, 'http://localhost').searchParams;
  const result = await proxyFavicon(query);
  res.writeHead(result.status, result.headers).end(result.body);
}
