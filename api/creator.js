// Vercel serverless function: /api/creator?op=config|channel|authorize|exchange|fetch|revoke
// The Creator widgets' server side (YouTube and Instagram analytics); see _creatorProxy.js.

import { clientIp, handleCreator, readJsonBody } from './_creatorProxy.js';

export default async function handler(req, res) {
  const query = new URL(req.url, 'http://localhost').searchParams;
  const result = await handleCreator({
    method: req.method,
    query,
    body: await readJsonBody(req),
    origin: req.headers.origin || '',
    ip: clientIp(req),
  }, process.env);
  res.writeHead(result.status, result.headers).end(result.body);
}
