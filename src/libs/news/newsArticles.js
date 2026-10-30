// Pure helpers for news articles: validation, normalization, de-duplication, local search
// and time labels. Articles come from api/_newsProxy.js but are treated as untrusted here too
// (they are cached and shown as plain text, never as HTML).

/** An absolute http(s) URL, or null. */
export function safeUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** "thehindu.com" for "https://www.thehindu.com/", or null. */
export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

const cleanText = (value, max) =>
  typeof value === 'string' ? [...value].filter((ch) => ch.charCodeAt(0) >= 32).join('').replace(/\s+/g, ' ').trim().slice(0, max) : '';

// Stable id when none is supplied: a short hash of the URL (FNV-1a).
function hashId(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `u${(h >>> 0).toString(36)}`;
}

/** A clean article, or null when it can't be shown (no headline, no valid link or date). */
export function normalizeArticle(raw, { category = null } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const url = safeUrl(raw.url);
  const title = cleanText(raw.title, 300);
  const time = Date.parse(raw.publishedAt);
  if (!url || !title || !Number.isFinite(time)) return null;
  const id = cleanText(raw.id, 200).replace(/[^\w-]/g, '') || hashId(url);
  const related = Array.isArray(raw.related)
    ? raw.related
      .map((r) => ({ title: cleanText(r?.title, 300), url: safeUrl(r?.url), sourceName: cleanText(r?.sourceName, 80) || null }))
      .filter((r) => r.title && r.url)
      .slice(0, 4)
    : [];
  return {
    id,
    title,
    url,
    sourceName: cleanText(raw.sourceName, 80) || 'Google News',
    sourceUrl: safeUrl(raw.sourceUrl),
    publishedAt: new Date(time).toISOString(),
    category: raw.category ?? category,
    related,
  };
}

const titleKey = (article) => `${article.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}|${article.sourceName.toLowerCase()}`;

/** Normalized, de-duplicated by id and by headline + publisher, in the original order. */
export function dedupeArticles(list, options) {
  const ids = new Set();
  const titles = new Set();
  const out = [];
  for (const raw of list || []) {
    const article = raw && raw.id && raw.publishedAt && raw.sourceName ? raw : normalizeArticle(raw, options);
    if (!article) continue;
    const key = titleKey(article);
    if (ids.has(article.id) || titles.has(key)) continue;
    ids.add(article.id);
    titles.add(key);
    out.push(article);
  }
  return out;
}

/** Local search: every word must appear in the headline, publisher, section or coverage. */
export function filterArticles(articles, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return articles;
  return articles.filter((article) => {
    const haystack = [article.title, article.sourceName, article.category, ...(article.related || []).map((r) => r.title)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** "Just now", "12 min ago", "3 hr ago", "Yesterday", "14 Oct". */
export function formatPublishedAt(iso, now = Date.now()) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const minutes = Math.round((now - time) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const day = new Date(time).setHours(0, 0, 0, 0);
  const today = new Date(now).setHours(0, 0, 0, 0);
  if (today - day === 86400000) return 'Yesterday';
  return new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
