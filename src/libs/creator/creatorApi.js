// Calls to iWeb's own creator API (api/creator.js). The browser never talks to Google or Meta
// with credentials: it sends the sealed grant to the proxy, which does (see _creatorProxy.js).
import { apiUrl } from '../apiBase.js';

const TIMEOUT_MS = 20000;
// `npm run dev` with VITE_CREATOR_MOCK=1 answers from creatorMock.js (sample data, no
// credentials). import.meta.env.DEV is false in every build, so the mock is never bundled.
const MOCK = import.meta.env.DEV && import.meta.env.VITE_CREATOR_MOCK === '1';

export class CreatorError extends Error {
  constructor(code, message, { retryAfter = null, status = 0 } = {}) {
    super(message);
    this.name = 'CreatorError';
    this.code = code;
    this.retryAfter = retryAfter;
    this.status = status;
  }
}

// Errors the person has to act on (connect again, allow access): never retried on a timer.
export const NEEDS_ACTION = new Set(['REVOKED', 'PERMISSION', 'UNSUPPORTED_ACCOUNT', 'NO_CHANNEL', 'NOT_CONFIGURED', 'NOT_FOUND', 'BAD_REQUEST']);

async function call(op, { params = {}, body = null, signal } = {}) {
  if (MOCK) return (await import('./creatorMock.js')).mockCall(op, { params, body });
  const url = apiUrl('/api/creator');
  if (!url) throw new CreatorError('NOT_CONFIGURED', 'This copy of iWeb has no server to connect accounts through.');
  url.searchParams.set('op', op);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let res;
  try {
    res = await fetch(url, body
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal, cache: 'no-store' }
      : { signal: controller.signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new CreatorError('OFFLINE', 'You’re offline.');
    throw new CreatorError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK', 'Couldn’t reach iWeb’s server. Try again.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const retry = Number(res.headers.get('retry-after'));
    throw new CreatorError(data?.error?.code || 'UPSTREAM', data?.error?.message || 'Something went wrong. Try again.', {
      status: res.status,
      retryAfter: Number.isFinite(retry) && retry > 0 ? retry * 1000 : null,
    });
  }
  return data;
}

/** { youtube: { lookup, connect } } — what this server can do. */
export const getConfig = (opts) => call('config', opts);

/** Public stats of a YouTube channel (@handle, ID or link). */
export const lookupChannel = (q, opts) => call('channel', { ...opts, params: { q } });

/** The consent page to open for `platform`. */
export const authorizeUrl = ({ platform, state, challenge, revenue }, opts) =>
  call('authorize', { ...opts, params: { platform, state, challenge, ...(revenue ? { revenue: '1' } : {}) } }).then((r) => r.url);

/** Trades a code for { account, grant, data }. */
export const exchangeCode = ({ platform, code, verifier, currency }, opts) =>
  call('exchange', { ...opts, body: { platform, code, verifier, currency } });

/** Latest data for a connected account: { data, grant? } (a renewed grant replaces the old). */
export const fetchOwnerData = ({ platform, grant, currency }, opts) => call('fetch', { ...opts, body: { platform, grant, currency } });

/** Asks Google to revoke access. */
export const revokeGrant = ({ platform, grant }, opts) => call('revoke', { ...opts, body: { platform, grant } });
