// Shared news state for the News widget and the News app: one source of truth, cache first.
//
//   loadFeed({ category })  — a section (or Top Stories): cached articles at once, then a
//                             refresh only if the feed is older than refreshIntervalMs.
//   search(query)           — Google News search (explicit; never per keystroke).
//   refresh(target)         — explicit refresh, ignoring freshness and backoff.
//
// Refreshes are coordinated across tabs: a Web Lock per feed lets one tab fetch while others
// wait, and a BroadcastChannel tells every tab to re-read the stored feed. A failed refresh
// keeps the stored articles and backs off (30 s, 1 min, 2 min… 15 min; 15 min after a
// rate limit). Nothing here runs on a timer except the low-frequency refresh of feeds that
// are on screen, and nothing here is triggered by the widget's headline rotation.
import { DEFAULT_EDITION, EDITION_STORAGE_KEY, NEWS_CATEGORIES, NEWS_CONFIG, NEWS_EDITIONS, feedKey } from './newsConfig';
import { fetchNewsFeed, searchNews } from './newsApi';
import { pruneNews, readFeed, saveFeed } from './newsCache';

const CHANNEL = 'iweb-news';

function readEdition() {
  try {
    const stored = localStorage.getItem(EDITION_STORAGE_KEY);
    return NEWS_EDITIONS.some((e) => e.id === stored) ? stored : DEFAULT_EDITION;
  } catch {
    return DEFAULT_EDITION;
  }
}

let state = {
  edition: readEdition(),
  articles: {}, // id → article
  feeds: {}, // key → { articleIds, fetchedAt, status: 'idle'|'loading'|'ready'|'error', error, fromCache }
};
const listeners = new Set();
const hydrated = new Set(); // feed keys already read from IndexedDB
const loading = new Map(); // feed key → promise (this tab)
const failures = new Map(); // feed key → { count, retryAt }
let channel = null;
let pruned = false;

function emit() {
  for (const listener of [...listeners]) listener();
}

function setFeed(key, patch) {
  state = { ...state, feeds: { ...state.feeds, [key]: { articleIds: [], fetchedAt: 0, status: 'idle', error: null, ...state.feeds[key], ...patch } } };
  emit();
}

function mergeArticles(list) {
  if (!list.length) return;
  const articles = { ...state.articles };
  for (const article of list) articles[article.id] = article;
  state = { ...state, articles };
}

export function subscribe(listener) {
  listeners.add(listener);
  ensureChannel();
  return () => listeners.delete(listener);
}

export function getState() {
  return state;
}

/** Articles of a feed, in feed order. */
export function feedArticles(snapshot, key) {
  const ids = snapshot.feeds[key]?.articleIds || [];
  return ids.map((id) => snapshot.articles[id]).filter(Boolean);
}

// --- cross-tab ----------------------------------------------------------------------------

function ensureChannel() {
  if (channel || typeof BroadcastChannel === 'undefined') return;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (e) => {
      const { type, key } = e.data || {};
      if (type === 'feed' && typeof key === 'string') hydrate(key, { force: true }).catch(() => {});
    };
  } catch {
    channel = null;
  }
}

function announce(key) {
  try {
    channel?.postMessage({ type: 'feed', key });
  } catch {
    // Other tabs simply refresh on their own schedule.
  }
}

// Runs `fn` while holding this feed's lock; `null` when another tab holds it.
async function withFeedLock(key, fn) {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : null;
  if (!locks?.request) return fn();
  return locks.request(`iweb-news:${key}`, { ifAvailable: true }, (lock) => (lock ? fn() : null));
}

// --- loading ----------------------------------------------------------------------------

async function hydrate(key, { force = false } = {}) {
  if (hydrated.has(key) && !force) return state.feeds[key] || null;
  hydrated.add(key);
  let stored = null;
  try {
    stored = await readFeed(key);
  } catch (err) {
    console.warn('[news] cache read failed:', err?.message || err);
  }
  if (stored) {
    mergeArticles(stored.articles);
    const fresher = stored.feed.fetchedAt >= (state.feeds[key]?.fetchedAt || 0);
    if (fresher) {
      setFeed(key, {
        articleIds: stored.articles.map((a) => a.id),
        fetchedAt: stored.feed.fetchedAt,
        status: state.feeds[key]?.status === 'loading' ? 'loading' : 'ready',
        fromCache: true,
      });
    }
  }
  return state.feeds[key] || null;
}

const isStale = (feed, now) => !feed?.fetchedAt || now - feed.fetchedAt > NEWS_CONFIG.refreshIntervalMs;

function noteFailure(key, err, now) {
  const count = (failures.get(key)?.count || 0) + 1;
  const wait = err?.code === 'RATE_LIMITED'
    ? NEWS_CONFIG.rateLimitPauseMs
    : Math.min(NEWS_CONFIG.backoffMaxMs, NEWS_CONFIG.backoffBaseMs * 2 ** (count - 1));
  failures.set(key, { count, retryAt: now + wait });
}

async function fetchFeed(target, key) {
  const { edition } = target;
  return withFeedLock(key, async () => {
    // Another tab may have just stored it while this one waited.
    const latest = await hydrate(key, { force: true });
    if (!target.force && latest && !isStale(latest, Date.now())) return latest;

    const articles = target.query
      ? await searchNews({ edition, query: target.query })
      : await fetchNewsFeed({ edition, topic: target.topic, category: target.category });
    const fetchedAt = Date.now();
    mergeArticles(articles);
    setFeed(key, { articleIds: articles.map((a) => a.id), fetchedAt, status: 'ready', error: null, fromCache: false });
    failures.delete(key);
    try {
      await saveFeed({ key, kind: target.query ? 'search' : 'section', edition, topic: target.topic, query: target.query, fetchedAt }, articles);
      announce(key);
      if (!pruned) {
        pruned = true;
        pruneNews().catch(() => {});
      }
    } catch (err) {
      console.warn('[news] cache write failed:', err?.message || err);
    }
    return state.feeds[key];
  });
}

/**
 * Loads a feed: { category } (section id from NEWS_CATEGORIES) or { query } (search).
 * Shows what is stored at once; fetches only when stale, missing or forced.
 */
export function loadFeed({ category = 'top', query = null, force = false, edition = state.edition } = {}) {
  const key = feedKey({ edition, category, query });
  if (loading.has(key)) return loading.get(key);
  const topic = query ? null : NEWS_CATEGORIES.find((c) => c.id === category)?.topic ?? null;
  const target = { edition, category: query ? null : category, topic, query, force };

  const run = (async () => {
    const feed = await hydrate(key);
    const now = Date.now();
    if (!force && feed && !isStale(feed, now)) return feed;
    const failure = failures.get(key);
    if (!force && failure && now < failure.retryAt) return feed;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setFeed(key, { status: feed?.articleIds?.length ? 'ready' : 'error', error: { code: 'OFFLINE', message: 'You’re offline.' } });
      return state.feeds[key];
    }
    setFeed(key, { status: 'loading', error: null });
    try {
      const result = await fetchFeed(target, key);
      // Another tab held the lock: it will announce the result; show what is stored meanwhile.
      if (result === null) setFeed(key, { status: state.feeds[key]?.articleIds?.length ? 'ready' : 'loading' });
      return state.feeds[key];
    } catch (err) {
      noteFailure(key, err, Date.now());
      setFeed(key, { status: 'error', error: { code: err?.code || 'NETWORK', message: err?.message || 'Couldn’t load the news.' } });
      return state.feeds[key];
    }
  })().finally(() => loading.delete(key));

  loading.set(key, run);
  return run;
}

export const search = (query, options) => loadFeed({ ...options, query: query.trim() });

export const refresh = (target = {}) => loadFeed({ ...target, force: true });

export function setEdition(edition) {
  if (!NEWS_EDITIONS.some((e) => e.id === edition) || edition === state.edition) return;
  try {
    localStorage.setItem(EDITION_STORAGE_KEY, edition);
  } catch {
    // Kept for this session only.
  }
  state = { ...state, edition };
  emit();
}

/** Test helper. */
export function _resetNewsStore() {
  state = { edition: readEdition(), articles: {}, feeds: {} };
  hydrated.clear();
  loading.clear();
  failures.clear();
  pruned = false;
  channel?.close();
  channel = null;
  listeners.clear();
}
