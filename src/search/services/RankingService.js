export class RankingService {
  constructor() {
    this.COEFFS = {
      exactMatch: 0.30,
      prefixMatch: 0.20,
      fuzzyMatch: 0.10,
      frequency: 0.15,
      recency: 0.10,
      ctr: 0.10,
      semantic: 0.05
    };
  }

  /**
   * Computes a score between 0.0 and 1.0 indicating how relevant a search item is.
   */
  calculateScore(
    item,
    query,
    historyClicks,
    totalQuerySearches
  ) {
    const normalizedQuery = query.toLowerCase().trim();
    const titleLower = item.title.toLowerCase();
    const urlLower = item.url.toLowerCase();

    // 1. Exact Match Weight
    const isExactTitle = titleLower === normalizedQuery;
    const isExactUrl = urlLower.includes(normalizedQuery) && urlLower.indexOf(normalizedQuery) === 0;
    const exactWeight = isExactTitle ? 1.0 : isExactUrl ? 0.8 : 0.0;

    // 2. Prefix Match Weight
    const isPrefixTitle = titleLower.startsWith(normalizedQuery);
    const prefixWeight = isPrefixTitle ? 0.9 : item.matchType === 'prefix' ? 0.6 : 0.0;

    // 3. Fuzzy Match Weight (using inverted Fuse score if matchType is fuzzy)
    const fuzzyWeight = item.matchType === 'fuzzy' ? item.score : 0.0;

    // 4. Frequency Weight (capped log scaling based on visit/usage counts)
    const visitCount = item.visitCount || 0;
    const clickCount = item.count || 0;
    const frequencyWeight = Math.min((visitCount + clickCount * 2) / 40, 1.0);

    // 5. Recency Weight (decays over time)
    let recencyWeight = 0.0;
    const timestamp = item.lastVisit || item.timestamp;
    if (timestamp) {
      const deltaMs = Date.now() - timestamp;
      const deltaDays = deltaMs / (24 * 3600 * 1000);
      
      if (deltaDays <= 1) recencyWeight = 1.0; // today
      else if (deltaDays <= 2) recencyWeight = 0.8; // yesterday
      else if (deltaDays <= 7) recencyWeight = 0.6; // this week
      else if (deltaDays <= 30) recencyWeight = 0.3; // this month
      else recencyWeight = 0.05; // older
    }

    // 6. Click-Through Rate (CTR) Weight (clicks on this URL for this query / total query searches)
    const clicksForUrl = historyClicks[item.url] || 0;
    const ctrWeight = totalQuerySearches > 0 ? Math.min(clicksForUrl / totalQuerySearches, 1.0) : 0.0;

    // 7. Semantic Weight (for Typesense matches)
    const semanticWeight = item.matchType === 'semantic' ? item.score : 0.0;

    // Combined weighted score
    const finalScore = (
      (exactWeight * this.COEFFS.exactMatch) +
      (prefixWeight * this.COEFFS.prefixMatch) +
      (fuzzyWeight * this.COEFFS.fuzzyMatch) +
      (frequencyWeight * this.COEFFS.frequency) +
      (recencyWeight * this.COEFFS.recency) +
      (ctrWeight * this.COEFFS.ctr) +
      (semanticWeight * this.COEFFS.semantic)
    );

    return parseFloat(finalScore.toFixed(3));
  }
}
export const rankingService = new RankingService();
