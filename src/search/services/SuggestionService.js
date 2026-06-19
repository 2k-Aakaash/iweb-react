import { db } from '../db/searchDB';
import { typesenseService } from './TypesenseService';

export class SuggestionService {
  constructor() {
    // Built-in commands supported by the browser extension
    this.CUSTOM_COMMANDS = [
      { text: '/settings', desc: 'Open Music Settings' },
      { text: '/music', desc: 'Open Music Library Modal' },
      { text: '/weather', desc: 'Open Weather Details' },
      { text: '/notes', desc: 'Open Notes Modal' },
      { text: '/help', desc: 'Show Help & Keyboard Shortcuts' }
    ];
  }

  /**
   * Generates omnibox suggestions ranked by score/recency/clicks.
   */
  async getSuggestions(query) {
    if (!query) {
      // Return recent searches or default list
      const recents = await db.searches.orderBy('lastUsed').reverse().limit(10).toArray();
      return recents.map((r) => ({
        id: `suggestion-recent-${r.id}`,
        title: r.query,
        url: '',
        type: 'command',
        score: 1.0,
        matchType: 'exact'
      }));
    }

    const q = query.toLowerCase().trim();
    const suggestions = [];

    // 1. Gather Custom Commands matching query
    this.CUSTOM_COMMANDS.forEach((cmd) => {
      if (cmd.text.startsWith(q)) {
        suggestions.push({
          id: `cmd-${cmd.text}`,
          title: cmd.text,
          url: cmd.desc,
          type: 'command',
          score: 1.0,
          matchType: 'prefix'
        });
      }
    });

    // 2. Query Bookmarks table (prefix matches)
    const matchedBookmarks = await db.bookmarks
      .filter((b) => b.title.toLowerCase().startsWith(q) || b.url.toLowerCase().includes(q))
      .limit(10)
      .toArray();

    matchedBookmarks.forEach((b) => {
      suggestions.push({
        id: `bookmark-${b.id}`,
        title: b.title,
        url: b.url,
        type: 'bookmark',
        score: b.isFavorite ? 0.95 : 0.85,
        matchType: b.title.toLowerCase().startsWith(q) ? 'prefix' : 'fuzzy',
        folder: b.folder
      });
    });

    // 3. Query History table (prefix matches or high usage)
    const matchedHistory = await db.history
      .filter((h) => h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q))
      .limit(15)
      .toArray();

    matchedHistory.forEach((h) => {
      const isPrefix = h.title.toLowerCase().startsWith(q);
      const score = isPrefix ? 0.9 : 0.7;
      suggestions.push({
        id: `history-${h.id}`,
        title: h.title,
        url: h.url,
        type: 'history',
        score: score + Math.min(h.visitCount / 100, 0.09), // Boost high visit count
        matchType: isPrefix ? 'prefix' : 'fuzzy',
        visitCount: h.visitCount,
        lastVisit: h.lastVisit
      });
    });

    // 4. Query Search History (searches table)
    const matchedSearches = await db.searches
      .filter((s) => s.normalized.includes(q))
      .limit(10)
      .toArray();

    matchedSearches.forEach((s) => {
      const isPrefix = s.normalized.startsWith(q);
      suggestions.push({
        id: `search-history-${s.id}`,
        title: s.query,
        url: '',
        type: 'command',
        score: (isPrefix ? 0.88 : 0.68) + Math.min(s.count / 100, 0.1),
        matchType: isPrefix ? 'prefix' : 'fuzzy',
        count: s.count
      });
    });

    // 5. Query Typesense (if enabled)
    if (typesenseService.isServiceEnabled()) {
      const semanticSuggestions = await typesenseService.search(q, 'browser_suggestions');
      suggestions.push(...semanticSuggestions);
    }

    // 6. Merge, Deduplicate and Sort Suggestions
    const mergedMap = new Map();
    suggestions.forEach((item) => {
      const key = `${item.type}-${item.title}-${item.url}`;
      const existing = mergedMap.get(key);
      if (!existing || existing.score < item.score) {
        mergedMap.set(key, item);
      }
    });

    const finalSuggestions = Array.from(mergedMap.values());

    // Sort by highest score descending
    return finalSuggestions.sort((a, b) => b.score - a.score);
  }
}
export const suggestionService = new SuggestionService();
