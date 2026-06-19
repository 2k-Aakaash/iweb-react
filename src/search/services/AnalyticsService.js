import { db } from '../db/searchDB';

export class AnalyticsService {
  /**
   * Tracks a new search term, incrementing its usage count.
   */
  async recordSearch(query) {
    const normalized = query.toLowerCase().trim();
    if (!normalized) return;

    const record = await db.searches.where('normalized').equals(normalized).first();
    if (record) {
      await db.searches.update(record.id, {
        count: record.count + 1,
        lastUsed: Date.now()
      });
    } else {
      await db.searches.add({
        query,
        normalized,
        count: 1,
        lastUsed: Date.now(),
        avgSelection: 0
      });
    }
  }

  /**
   * Records a user clicking on a search result item.
   */
  async recordClick(
    query,
    clickedId,
    clickedUrl,
    position
  ) {
    const clickId = await db.clicks.add({
      query: query.toLowerCase().trim(),
      clickedId,
      clickedUrl,
      position,
      timestamp: Date.now()
    });

    // Update average selection position for the search query
    const normalizedQuery = query.toLowerCase().trim();
    const searchRecord = await db.searches.where('normalized').equals(normalizedQuery).first();
    if (searchRecord) {
      const allQueryClicks = await db.clicks.where('query').equals(normalizedQuery).toArray();
      const avgPos = allQueryClicks.reduce((acc, click) => acc + click.position, 0) / allQueryClicks.length;
      await db.searches.update(searchRecord.id, {
        avgSelection: parseFloat(avgPos.toFixed(2))
      });
    }

    // Increment click counts in suggestions
    const suggestionRecord = await db.suggestions.where('normalized').equals(clickedId.toLowerCase()).first();
    if (suggestionRecord) {
      await db.suggestions.update(suggestionRecord.id, {
        clickCount: suggestionRecord.clickCount + 1,
        lastUsed: Date.now()
      });
    }

    return clickId;
  }

  /**
   * Records dwell time when a user views a search result.
   */
  async recordDwellTime(clickId, durationSeconds) {
    if (!clickId || durationSeconds <= 0) return;
    
    await db.clicks.update(clickId, {
      dwellTime: durationSeconds
    });
  }

  /**
   * Retrieves click history mapping URL to click count for a given search query.
   */
  async getHistoryClicksForQuery(query) {
    const normalized = query.toLowerCase().trim();
    const clicks = await db.clicks.where('query').equals(normalized).toArray();
    
    const clickMap = {};
    clicks.forEach((click) => {
      clickMap[click.clickedUrl] = (clickMap[click.clickedUrl] || 0) + 1;
    });

    return clickMap;
  }

  /**
   * Retrieves total searches recorded for a query term.
   */
  async getTotalQuerySearches(query) {
    const normalized = query.toLowerCase().trim();
    const record = await db.searches.where('normalized').equals(normalized).first();
    return record ? record.count : 0;
  }

  /**
   * Retrieves the last 100 queries searched by the user.
   */
  async getRecentSearches(limit = 100) {
    return db.searches
      .orderBy('lastUsed')
      .reverse()
      .limit(limit)
      .toArray();
  }
}
export const analyticsService = new AnalyticsService();
