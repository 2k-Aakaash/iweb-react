// Client for iWeb's /api/news proxy (api/_newsProxy.js). Responses are normalized again here;
// identical requests already in flight share one fetch.
import { apiUrl } from '../apiBase';
import { NEWS_CONFIG } from './newsConfig';
import { dedupeArticles } from './newsArticles';

export class NewsError extends Error {
  /** code: OFFLINE | NETWORK | TIMEOUT | RATE_LIMITED | UPSTREAM | BAD_QUERY | NOT_CONFIGURED */
  constructor(code, message) {
    super(message);
    this.name = 'NewsError';
    this.code = code;
  }
}

const inFlight = new Map(); // request URL → promise

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

async function request(params, { signal } = {}) {
  const url = apiUrl('/api/news');
  if (!url) throw new NewsError('NOT_CONFIGURED', 'News isn’t available in this build.');
  for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, value);
  if (isOffline()) throw new NewsError('OFFLINE', 'You’re offline.');

  const href = url.href;
  if (!inFlight.has(href)) {
    const promise = (async () => {
      let res;
      try {
        res = await fetch(href, { signal: AbortSignal.timeout(NEWS_CONFIG.requestTimeoutMs) });
      } catch (err) {
        if (err?.name === 'TimeoutError') throw new NewsError('TIMEOUT', 'News took too long to load.');
        throw new NewsError(isOffline() ? 'OFFLINE' : 'NETWORK', isOffline() ? 'You’re offline.' : 'Couldn’t reach the news service.');
      }
      let body = null;
      try {
        body = await res.json();
      } catch {
        // handled below
      }
      if (!res.ok) {
        const code = body?.error?.code;
        if (res.status === 429 || code === 'RATE_LIMITED') throw new NewsError('RATE_LIMITED', 'News is busy right now. Try again shortly.');
        if (code === 'BAD_QUERY') throw new NewsError('BAD_QUERY', body.error.message);
        throw new NewsError('UPSTREAM', 'Couldn’t load the news right now.');
      }
      if (!body || !Array.isArray(body.articles)) throw new NewsError('UPSTREAM', 'The news service sent an unexpected response.');
      return body.articles;
    })().finally(() => inFlight.delete(href));
    inFlight.set(href, promise);
  }

  // A caller's own abort only detaches that caller; the shared request carries on.
  const shared = inFlight.get(href);
  if (!signal) return shared;
  return Promise.race([
    shared,
    new Promise((_, reject) => {
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  ]);
}

/** Top stories (topic null) or a section of an edition. */
export async function fetchNewsFeed({ edition, topic = null, category = null, signal } = {}) {
  const articles = await request({ op: 'feed', edition, topic }, { signal });
  return dedupeArticles(articles, { category });
}

/** Google News search within an edition. */
export async function searchNews({ edition, query, signal } = {}) {
  const articles = await request({ op: 'search', edition, q: query }, { signal });
  return dedupeArticles(articles);
}

/** Test helper. */
export function _resetNewsApi() {
  inFlight.clear();
}
