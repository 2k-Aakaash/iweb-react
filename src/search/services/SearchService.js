import { db } from '../db/searchDB';
import { typesenseService } from './TypesenseService';
import { analyticsService } from './AnalyticsService';
import { rankingService } from './RankingService';

export class SearchService {
  constructor() {
    this.worker = null;
    this.workerPromise = null;
    this.resolveWorkerReady = null;
    this.searchPromises = new Map();
    this.initWorker();
  }

  /**
   * Spawns worker and sets up message handlers.
   */
  initWorker() {
    if (typeof window === 'undefined') return;

    try {
      // Vite standard URL worker instantiation pointing to search.worker.js
      this.worker = new Worker(
        new URL('../workers/search.worker.js', import.meta.url),
        { type: 'module' }
      );

      this.workerPromise = new Promise((resolve) => {
        this.resolveWorkerReady = resolve;
      });

      this.worker.onmessage = (e) => {
        const { status, results, error } = e.data;

        if (status === 'ready' && this.resolveWorkerReady) {
          this.resolveWorkerReady();
          console.log('Search worker initialized and ready.');
        } else if (status === 'results') {
          // Resolve outstanding search promise
          const resolveSearch = this.searchPromises.get('active-search');
          if (resolveSearch) {
            resolveSearch(results || []);
            this.searchPromises.delete('active-search');
          }
        } else if (status === 'error') {
          console.error('Search worker error:', error);
        }
      };
    } catch (e) {
      console.error('Failed to initialize search worker:', e);
    }
  }

  /**
   * Feeds latest IndexedDB datasets (bookmarks, history, suggestions) to the worker indexes.
   */
  async syncIndexes() {
    if (!this.worker) return;

    const [bookmarks, history, suggestions] = await Promise.all([
      db.bookmarks.toArray(),
      db.history.toArray(),
      db.suggestions.toArray()
    ]);

    this.worker.postMessage({
      action: 'initialize',
      payload: { bookmarks, history, suggestions }
    });

    await this.workerPromise;
  }

  /**
   * Executes the full search pipeline.
   * FlexSearch prefix search + Fuse fuzzy search (Worker) + Typesense semantic search (Main)
   */
  async search(query, options) {
    if (!query) return [];

    // Track search query count in background
    analyticsService.recordSearch(query);

    const normalizedQuery = query.toLowerCase().trim();
    
    // 1. Fetch query analytics from local database for ranking adjustments
    const [historyClicks, totalSearches] = await Promise.all([
      analyticsService.getHistoryClicksForQuery(normalizedQuery),
      analyticsService.getTotalQuerySearches(normalizedQuery)
    ]);

    // 2. Fetch local prefix + fuzzy matches from worker thread
    const workerSearchPromise = new Promise((resolve) => {
      if (!this.worker) {
        resolve([]);
        return;
      }
      this.searchPromises.set('active-search', resolve);
      this.worker.postMessage({
        action: 'search',
        payload: { query, options }
      });
    });

    // 3. Fetch Typesense semantic results (if enabled)
    const typesensePromise = typesenseService.isServiceEnabled()
      ? typesenseService.search(query, 'browser_search_items', {
          filterBy: options?.type ? `type:=${options.type}` : ''
        })
      : Promise.resolve([]);

    // 4. Await both sources parallelly
    const [localResults, semanticResults] = await Promise.all([
      workerSearchPromise,
      typesensePromise
    ]);

    // 5. Merge and apply final scoring/ranking incorporating clicks, CTR, and semantic matches
    const mergedResults = new Map();

    // Add local results (FlexSearch + Fuse)
    localResults.forEach((item) => {
      mergedResults.set(item.id, item);
    });

    // Add dynamic Web search results
    const webResults = this.generateWebResults(query);
    webResults.forEach((item) => {
      mergedResults.set(item.id, item);
    });

    // Add/Update semantic results
    semanticResults.forEach((item) => {
      const existing = mergedResults.get(item.id);
      if (existing) {
        existing.matchType = 'semantic';
        existing.score = Math.max(existing.score, item.score);
      } else {
        mergedResults.set(item.id, item);
      }
    });

    const combinedList = Array.from(mergedResults.values());

    // Re-evaluate combined scores on main thread incorporating CTR and exact match preferences
    const scoredList = combinedList.map((item) => {
      const finalScore = rankingService.calculateScore(
        item,
        query,
        historyClicks,
        totalSearches
      );
      return {
        ...item,
        score: finalScore
      };
    });

    // Sort by final score desc
    return scoredList.sort((a, b) => b.score - a.score);
  }

  generateWebResults(query) {
    if (!query) return [];
    const q = query.trim();
    const qCap = q.charAt(0).toUpperCase() + q.slice(1);
    return [
      {
        id: `web-google-${q}`,
        title: `${qCap} - Google Search`,
        url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
        type: 'web',
        score: 0.85,
        matchType: 'exact'
      },
      {
        id: `web-wiki-${q}`,
        title: `${qCap} - Wikipedia`,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(q)}`,
        type: 'web',
        score: 0.8,
        matchType: 'prefix'
      },
      {
        id: `web-github-${q}`,
        title: `GitHub Repository Search: "${q}"`,
        url: `https://github.com/search?q=${encodeURIComponent(q)}`,
        type: 'web',
        score: 0.75,
        matchType: 'prefix'
      },
      {
        id: `web-news-${q}`,
        title: `Latest Google News regarding ${qCap}`,
        url: `https://news.google.com/search?q=${encodeURIComponent(q)}`,
        type: 'web',
        score: 0.7,
        matchType: 'fuzzy'
      }
    ];
  }
}
export const searchService = new SearchService();
