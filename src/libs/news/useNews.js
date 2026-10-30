import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { NEWS_CONFIG, feedKey } from './newsConfig';
import { feedArticles, getState, loadFeed, subscribe } from './newsStore';
import { createRotation } from './newsRotation';

/** The whole shared news state (edition, feeds, articles). */
export function useNewsState() {
  return useSyncExternalStore(subscribe, getState, getState);
}

/**
 * A feed's articles and status: { category } or { query }. Loads it (cache first) while
 * `enabled`, and refreshes it when it goes stale while on screen; never more often.
 */
export function useNewsFeed({ category = 'top', query = null, enabled = true } = {}) {
  const snapshot = useNewsState();
  const { edition } = snapshot;
  const key = feedKey({ edition, category, query });
  const feed = snapshot.feeds[key];
  const articleIds = feed?.articleIds;
  const articles = useMemo(
    () => feedArticles({ feeds: { [key]: { articleIds } }, articles: snapshot.articles }, key),
    [key, articleIds, snapshot.articles],
  );

  useEffect(() => {
    if (!enabled) return;
    loadFeed({ category, query, edition });
  }, [enabled, category, query, edition]);

  // Low-frequency refresh of a feed on screen: when it turns stale, and only while visible.
  const fetchedAt = feed?.fetchedAt || 0;
  useEffect(() => {
    if (!enabled || !fetchedAt) return undefined;
    let timer = 0;
    const due = () => {
      if (document.visibilityState === 'visible') loadFeed({ category, query, edition });
    };
    timer = setTimeout(due, Math.max(5000, fetchedAt + NEWS_CONFIG.refreshIntervalMs - Date.now()));
    return () => clearTimeout(timer);
  }, [enabled, fetchedAt, category, query, edition]);

  return { key, edition, feed, articles };
}

/**
 * The headline the News widget shows, changing every 10 seconds among `articles` (already in
 * memory). One timer for the component's life; new articles don't restart it, and it never
 * fetches.
 */
export function useNewsRotation(articles, { enabled = true } = {}) {
  const idsRef = useRef([]);
  const [currentId, setCurrentId] = useState(null);
  const rotationRef = useRef(null);

  const ids = useMemo(() => articles.map((a) => a.id), [articles]);
  useEffect(() => {
    idsRef.current = ids;
    rotationRef.current?.sync();
  }, [ids]);

  useEffect(() => {
    if (!enabled) return undefined;
    const rotation = createRotation({ getIds: () => idsRef.current, onChange: setCurrentId });
    rotationRef.current = rotation;
    rotation.start();
    return () => {
      rotation.stop();
      rotationRef.current = null;
    };
  }, [enabled]);

  return articles.find((a) => a.id === currentId) || articles[0] || null;
}
