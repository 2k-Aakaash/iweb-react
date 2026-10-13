// Vercel serverless function: GET /api/unsplash?path=/photos/random&query=...
// Set UNSPLASH_ACCESS_KEY (Secret) in Vercel → Project → Settings → Environment Variables.

import { CORS_HEADERS, proxyUnsplash } from './_unsplashProxy.js';

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
  const result = await proxyUnsplash(query, process.env.UNSPLASH_ACCESS_KEY);
  res.writeHead(result.status, result.headers).end(result.body);
}
