// News cache in iWebDB: articles stored once (news_articles, by id) and feeds as ordered id
// lists with their fetch time (news_feeds). A failed refresh never touches what is stored.
import { openIwebDB, reqToPromise, STORES, txDone } from '../wallpaper/db.js';
import { NEWS_CONFIG } from './newsConfig';

function isQuotaError(err) {
  return err?.name === 'QuotaExceededError' || err?.code === 22;
}

/** { feed, articles } for a feed key, or null when nothing is stored. */
export async function readFeed(key) {
  const db = await openIwebDB();
  const tx = db.transaction([STORES.NEWS_FEEDS, STORES.NEWS_ARTICLES], 'readonly');
  const feed = await reqToPromise(tx.objectStore(STORES.NEWS_FEEDS).get(key));
  if (!feed) return null;
  const store = tx.objectStore(STORES.NEWS_ARTICLES);
  const found = await Promise.all((feed.articleIds || []).map((id) => reqToPromise(store.get(id))));
  return { feed, articles: found.filter(Boolean) };
}

async function writeFeed(feed, articles) {
  const db = await openIwebDB();
  const tx = db.transaction([STORES.NEWS_FEEDS, STORES.NEWS_ARTICLES], 'readwrite');
  const store = tx.objectStore(STORES.NEWS_ARTICLES);
  for (const article of articles) store.put(article);
  tx.objectStore(STORES.NEWS_FEEDS).put(feed);
  await txDone(tx);
}

/** Stores a freshly fetched feed (replacing that feed's list; articles are shared). */
export async function saveFeed({ key, kind, edition, topic = null, query = null, fetchedAt = Date.now() }, articles) {
  const feed = { key, kind, edition, topic, query, fetchedAt, articleIds: articles.map((a) => a.id) };
  try {
    await writeFeed(feed, articles);
  } catch (err) {
    if (!isQuotaError(err)) throw err;
    // Out of space: drop old news and try once more.
    await pruneNews({ maxArticles: Math.floor(NEWS_CONFIG.maxStoredArticles / 2) });
    await writeFeed(feed, articles);
  }
  return feed;
}

/**
 * Keeps the cache bounded: search feeds beyond the newest few are dropped, then articles no
 * feed refers to are removed once old, and the oldest beyond `maxArticles`.
 */
export async function pruneNews({
  now = Date.now(),
  maxArticles = NEWS_CONFIG.maxStoredArticles,
  retentionMs = NEWS_CONFIG.retentionMs,
  maxSearchFeeds = NEWS_CONFIG.maxSearchFeeds,
} = {}) {
  const db = await openIwebDB();
  const tx = db.transaction([STORES.NEWS_FEEDS, STORES.NEWS_ARTICLES], 'readwrite');
  const feedStore = tx.objectStore(STORES.NEWS_FEEDS);
  const articleStore = tx.objectStore(STORES.NEWS_ARTICLES);
  const feeds = (await reqToPromise(feedStore.getAll())) || [];
  const articles = (await reqToPromise(articleStore.getAll())) || [];

  const searches = feeds.filter((f) => f.kind === 'search').sort((a, b) => b.fetchedAt - a.fetchedAt);
  const dropped = new Set(searches.slice(maxSearchFeeds).map((f) => f.key));
  for (const key of dropped) feedStore.delete(key);

  const referenced = new Set(feeds.filter((f) => !dropped.has(f.key)).flatMap((f) => f.articleIds || []));
  const newestFirst = [...articles].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  let kept = 0;
  let removed = 0;
  for (const article of newestFirst) {
    const old = now - Date.parse(article.publishedAt) > retentionMs;
    const keep = referenced.has(article.id) ? kept < maxArticles : !old && kept < maxArticles;
    if (keep) kept += 1;
    else {
      articleStore.delete(article.id);
      removed += 1;
    }
  }
  await txDone(tx);
  return { removedArticles: removed, removedFeeds: dropped.size };
}
