// iWeb News settings in one place. Data comes from Google News RSS through iWeb's own
// /api/news proxy (api/_newsProxy.js): no API key, cached 15 minutes at the CDN.

export const NEWS_CONFIG = Object.freeze({
  rotationIntervalMs: 10_000, // News widget headline rotation (local articles only, never a request)
  refreshIntervalMs: 20 * 60 * 1000, // a feed older than this is refreshed when next needed
  requestTimeoutMs: 12_000,
  maxStoredArticles: 400, // oldest unreferenced articles beyond this are pruned
  retentionMs: 3 * 24 * 60 * 60 * 1000, // articles not in any feed are dropped after this
  maxSearchFeeds: 12, // remembered remote searches
  backoffBaseMs: 30_000, // after a failed refresh: 30 s, 1 min, 2 min… up to the max
  backoffMaxMs: 15 * 60 * 1000,
  rateLimitPauseMs: 15 * 60 * 1000,
});

// Sections Google News offers. "Top Stories" is the edition's front page; "nation" is the
// edition country's own news (India for the India editions).
export const NEWS_CATEGORIES = Object.freeze([
  { id: 'top', label: 'Top Stories', topic: null },
  { id: 'nation', label: null, topic: 'NATION' }, // labelled with the edition's country
  { id: 'world', label: 'World', topic: 'WORLD' },
  { id: 'business', label: 'Business', topic: 'BUSINESS' },
  { id: 'technology', label: 'Technology', topic: 'TECHNOLOGY' },
  { id: 'science', label: 'Science', topic: 'SCIENCE' },
  { id: 'health', label: 'Health', topic: 'HEALTH' },
  { id: 'sports', label: 'Sports', topic: 'SPORTS' },
  { id: 'entertainment', label: 'Entertainment', topic: 'ENTERTAINMENT' },
]);

// Editions api/_newsProxy.js accepts (keep in sync).
export const NEWS_EDITIONS = Object.freeze([
  { id: 'IN:en', label: 'India · English', country: 'India' },
  { id: 'IN:hi', label: 'India · हिन्दी', country: 'India' },
  { id: 'US:en', label: 'United States', country: 'U.S.' },
  { id: 'GB:en', label: 'United Kingdom', country: 'U.K.' },
  { id: 'AU:en', label: 'Australia', country: 'Australia' },
  { id: 'CA:en', label: 'Canada', country: 'Canada' },
  { id: 'SG:en', label: 'Singapore', country: 'Singapore' },
]);

export const DEFAULT_EDITION = 'IN:en';
export const EDITION_STORAGE_KEY = 'iweb:newsEdition';

export function categoryLabel(category, editionId) {
  if (category.label) return category.label;
  return NEWS_EDITIONS.find((e) => e.id === editionId)?.country || 'Local';
}

/** Cache key of a feed: one per edition + section, or edition + search query. */
export function feedKey({ edition, category = null, query = null }) {
  return query ? `${edition}|search|${query.toLowerCase()}` : `${edition}|${category || 'top'}`;
}
