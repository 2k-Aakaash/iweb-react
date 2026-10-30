// Vercel serverless function: GET /api/news?op=feed|search&...
// Proxies Google News RSS as normalized JSON (no key needed); see _newsProxy.js.

import { CORS_HEADERS, proxyNews } from './_newsProxy.js';

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
  const result = await proxyNews(query);
  res.writeHead(result.status, result.headers).end(result.body);
}
