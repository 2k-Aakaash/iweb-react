import { useState, useEffect, useCallback } from 'react';
import { searchService } from '../services/SearchService';
import { suggestionService } from '../services/SuggestionService';
import { analyticsService } from '../services/AnalyticsService';
import { db, seedDatabase } from '../db/searchDB';

const SYNONYMS = {
  yt: 'youtube',
  gh: 'github',
  gm: 'gmail',
  gpt: 'chatgpt'
};

export function useSearch() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Initialize DB and sync worker index
  useEffect(() => {
    const initAndSync = async () => {
      try {
        await seedDatabase();
        await searchService.syncIndexes();
      } catch (e) {
        console.error('Error seeding/syncing database indexes:', e);
      }
    };
    initAndSync();
  }, []);

  // Expand query synonyms (e.g. yt -> youtube)
  const expandQuery = (rawQuery) => {
    const trimmed = rawQuery.toLowerCase().trim();
    if (SYNONYMS[trimmed]) {
      return SYNONYMS[trimmed];
    }
    return rawQuery;
  };

  // Parse custom search operators
  const parseOperators = (rawQuery) => {
    let cleanQuery = rawQuery;
    const options = {};

    // site:
    const siteMatch = cleanQuery.match(/site:([^\s]+)/i);
    if (siteMatch) {
      options.site = siteMatch[1];
      cleanQuery = cleanQuery.replace(/site:[^\s]+/gi, '');
    }

    // type:
    const typeMatch = cleanQuery.match(/type:(bookmark|history)/i);
    if (typeMatch) {
      options.type = typeMatch[1];
      cleanQuery = cleanQuery.replace(/type:[^\s]+/gi, '');
    }

    // before:
    const beforeMatch = cleanQuery.match(/before:(\d{4})/i);
    if (beforeMatch) {
      const year = parseInt(beforeMatch[1], 10);
      options.before = new Date(`${year}-01-01`).getTime();
      cleanQuery = cleanQuery.replace(/before:[^\s]+/gi, '');
    }

    // after:
    const afterMatch = cleanQuery.match(/after:(\d{4})/i);
    if (afterMatch) {
      const year = parseInt(afterMatch[1], 10);
      options.after = new Date(`${year}-12-31`).getTime();
      cleanQuery = cleanQuery.replace(/after:[^\s]+/gi, '');
    }

    // is:favorite
    if (/is:favorite/i.test(cleanQuery)) {
      options.isFavorite = true;
      cleanQuery = cleanQuery.replace(/is:favorite/gi, '');
    }

    return {
      cleanQuery: cleanQuery.trim(),
      options
    };
  };

  // Handle live suggestions and results searches
  useEffect(() => {
    let active = true;

    const fetchLiveSuggestions = async () => {
      if (!query.trim()) {
        const defaultSuggests = await suggestionService.getSuggestions('');
        if (active) {
          setSuggestions(defaultSuggests);
          setResults([]);
        }
        return;
      }

      setIsLoading(true);
      try {
        const expanded = expandQuery(query);
        const { cleanQuery, options } = parseOperators(expanded);

        const [suggestList, resultList] = await Promise.all([
          suggestionService.getSuggestions(cleanQuery),
          searchService.search(cleanQuery, options)
        ]);

        if (active) {
          setSuggestions(suggestList);
          setResults(resultList);
        }
      } catch (e) {
        console.error('Error generating suggestions:', e);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    const delayDebounce = setTimeout(() => {
      fetchLiveSuggestions();
    }, 150); // debounce input queries to avoid index thrashing

    return () => {
      active = false;
      clearTimeout(delayDebounce);
    };
  }, [query]);

  // Execute full manual query search
  const search = useCallback(async (searchQuery) => {
    setIsLoading(true);
    try {
      const expanded = expandQuery(searchQuery);
      const { cleanQuery, options } = parseOperators(expanded);
      const items = await searchService.search(cleanQuery, options);
      setResults(items);
      return items;
    } catch (e) {
      console.error('Manual search failed:', e);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Record item selection (click tracking)
  const recordClick = useCallback(async (
    clickQuery,
    item,
    position
  ) => {
    return analyticsService.recordClick(
      clickQuery,
      item.title,
      item.url,
      position
    );
  }, []);

  // Log manual search query counter
  const recordSearch = useCallback(async (searchQuery) => {
    return analyticsService.recordSearch(searchQuery);
  }, []);

  // Clear query history
  const clearHistory = useCallback(async () => {
    try {
      await db.searches.clear();
      await db.clicks.clear();
      // Re-trigger suggestions load
      const defaultSuggests = await suggestionService.getSuggestions('');
      setSuggestions(defaultSuggests);
    } catch (e) {
      console.error('Failed to clear search database history:', e);
    }
  }, []);

  return {
    query,
    setQuery,
    suggestions,
    results,
    isLoading,
    search,
    clearHistory,
    recordClick,
    recordSearch
  };
}
