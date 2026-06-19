import { Index } from 'flexsearch';
import Fuse from 'fuse.js';

let flexSearchIndex = new Index({
  tokenize: 'forward',
  resolution: 9
});

let fuseIndex = null;
let rawItems = [];

// Worker messaging pipeline
self.addEventListener('message', async (e) => {
  const { action, payload } = e.data;

  try {
    switch (action) {
      case 'initialize':
        const { bookmarks, history, suggestions } = payload;
        buildIndexes(bookmarks, history, suggestions);
        self.postMessage({ status: 'ready' });
        break;

      case 'search':
        const { query, options } = payload;
        const results = await performSearch(query, options);
        self.postMessage({ status: 'results', results });
        break;

      default:
        console.warn(`Unknown worker action: ${action}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    self.postMessage({ status: 'error', error: errorMessage });
  }
});

function buildIndexes(
  bookmarks,
  history,
  suggestions
) {
  // Clear previous data
  flexSearchIndex = new Index({
    tokenize: 'forward',
    resolution: 9
  });
  rawItems = [];

  // 1. Process Bookmarks
  bookmarks.forEach((b) => {
    const item = {
      id: `bookmark-${b.id || Math.random()}`,
      title: b.title,
      url: b.url,
      type: 'bookmark',
      score: 0,
      matchType: 'exact',
      folder: b.folder
    };
    rawItems.push(item);
  });

  // 2. Process History
  history.forEach((h) => {
    const item = {
      id: `history-${h.id || Math.random()}`,
      title: h.title,
      url: h.url,
      type: 'history',
      score: 0,
      matchType: 'exact',
      visitCount: h.visitCount,
      lastVisit: h.lastVisit
    };
    rawItems.push(item);
  });

  // 3. Process Suggestions
  suggestions.forEach((s) => {
    const item = {
      id: `suggestion-${s.id || Math.random()}`,
      title: s.text,
      url: '',
      type: s.source === 'bookmark' ? 'bookmark' : s.source === 'history' ? 'history' : 'command',
      score: 0,
      matchType: 'exact'
    };
    rawItems.push(item);
  });

  // Populate FlexSearch
  rawItems.forEach((item, index) => {
    const searchText = `${item.title} ${item.url}`.toLowerCase();
    flexSearchIndex.add(index, searchText);
  });

  // Populate Fuse.js
  fuseIndex = new Fuse(rawItems, {
    keys: ['title', 'url', 'folder'],
    threshold: 0.3,
    distance: 100,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 1
  });

  console.log(`Worker initialized with ${rawItems.length} searchable items.`);
}

async function performSearch(query, options) {
  if (!query) return [];

  const normalizedQuery = query.toLowerCase().trim();
  const matchedIndexes = new Set();
  const finalResults = [];

  // Stage 1: FlexSearch Prefix Search (< 5ms)
  const prefixHits = flexSearchIndex.search(normalizedQuery, 50);
  prefixHits.forEach((hitIndex) => {
    const idx = typeof hitIndex === 'string' ? parseInt(hitIndex, 10) : hitIndex;
    if (!isNaN(idx) && idx >= 0 && idx < rawItems.length) {
      matchedIndexes.add(idx);
      const item = { ...rawItems[idx], matchType: 'prefix' };
      finalResults.push(item);
    }
  });

  // Stage 2: Fuse.js Fuzzy Search
  if (fuseIndex) {
    const fuzzyHits = fuseIndex.search(query);
    fuzzyHits.forEach((hit) => {
      const originalItem = hit.item;
      // Avoid duplicating items already matched by prefix search
      const isAlreadyMatched = finalResults.some(r => r.id === originalItem.id);
      if (!isAlreadyMatched) {
        const item = {
          ...originalItem,
          matchType: 'fuzzy',
          // Store raw fuse score (lower is better, we invert it during ranking)
          score: hit.score ? 1 - hit.score : 0.5
        };
        finalResults.push(item);
      }
    });
  }

  // Stage 3: Normalize and Apply Filters
  let filteredResults = finalResults.filter((item) => {
    // Exact search operator: site:github.com
    if (options?.site) {
      const match = item.url.toLowerCase().includes(options.site.toLowerCase());
      if (!match) return false;
    }
    // Type filters: type:bookmark, type:history
    if (options?.type) {
      if (item.type !== options.type) return false;
    }
    // Before date filter
    if (options?.before && item.lastVisit && item.lastVisit > options.before) {
      return false;
    }
    // After date filter
    if (options?.after && item.lastVisit && item.lastVisit < options.after) {
      return false;
    }
    // Favorite filter
    if (options?.isFavorite && item.type === 'bookmark' && !item.folder?.includes('Fav')) {
      return false;
    }

    return true;
  });

  // Stage 4: Rank Results
  filteredResults = filteredResults.map((item) => {
    const scores = calculateRelevance(item, normalizedQuery);
    return {
      ...item,
      score: scores
    };
  });

  // Sort by highest score descending
  return filteredResults.sort((a, b) => b.score - a.score);
}

// Internal ranking calculator within the worker context
function calculateRelevance(item, query) {
  let score = 0;

  // 1. Exact Match weight (Query matches exactly title or URL prefix)
  const isExactTitle = item.title.toLowerCase() === query;
  const isExactUrl = item.url.toLowerCase().includes(query);
  const exactMatchWeight = isExactTitle ? 1.0 : isExactUrl ? 0.8 : 0.0;

  // 2. Prefix Match weight
  const isPrefixTitle = item.title.toLowerCase().startsWith(query);
  const prefixWeight = isPrefixTitle ? 0.9 : item.matchType === 'prefix' ? 0.6 : 0.0;

  // 3. Fuzzy match weight
  const fuzzyWeight = item.matchType === 'fuzzy' ? item.score : 0.0;

  // 4. Frequency Weight (based on history visits / clicks)
  const visitCount = item.visitCount || 0;
  const frequencyWeight = Math.min(visitCount / 50, 1.0); // capped at 1.0 for 50+ visits

  // 5. Recency Weight
  let recencyWeight = 0;
  if (item.lastVisit) {
    const ageMs = Date.now() - item.lastVisit;
    const ageDays = ageMs / (24 * 3600 * 1000);
    if (ageDays <= 1) recencyWeight = 1.0;
    else if (ageDays <= 2) recencyWeight = 0.8;
    else if (ageDays <= 7) recencyWeight = 0.6;
    else if (ageDays <= 30) recencyWeight = 0.3;
    else recencyWeight = 0.05;
  }

  // Composite ranking score
  score = (
    (exactMatchWeight * 0.30) +
    (prefixWeight * 0.25) +
    (fuzzyWeight * 0.15) +
    (frequencyWeight * 0.20) +
    (recencyWeight * 0.10)
  );

  return parseFloat(score.toFixed(3));
}
