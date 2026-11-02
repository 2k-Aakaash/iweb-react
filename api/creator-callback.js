// Vercel serverless function: GET /api/creator-callback — the OAuth redirect URI registered
// with Google and Meta. Passes the code on to the iWeb page that started sign-in; see
// handleCallback in _creatorProxy.js.

import { handleCallback } from './_creatorProxy.js';

export default function handler(req, res) {
  const result = handleCallback(new URL(req.url, 'http://localhost').searchParams);
  res.writeHead(result.status, result.headers).end(result.body);
}
