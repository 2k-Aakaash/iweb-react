// Vercel serverless function: GET /api/market?op=spark|chart|search&...
// Proxies Yahoo Finance market data (no key needed); see _marketProxy.js.

import { CORS_HEADERS, proxyMarket } from './_marketProxy.js';

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
  const result = await proxyMarket(query);
  res.writeHead(result.status, result.headers).end(result.body);
}
