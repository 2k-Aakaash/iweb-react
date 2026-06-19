import { flexSearchEngine } from './FlexSearchEngine';
import { fuseSearchEngine } from './FuseSearchEngine';

export class HybridSearchEngine {
  initialize(items) {
    flexSearchEngine.initialize(items);
    fuseSearchEngine.initialize(items);
  }

  search(query) {
    const prefixResults = flexSearchEngine.search(query);
    const fuzzyResults = fuseSearchEngine.search(query);

    const merged = new Map();

    // 1. Add prefix results first (prefer prefix/exact matches)
    prefixResults.forEach((item) => {
      const normalizedUrl = this.normalizeUrl(item.url);
      const key = `${item.type}-${item.title}-${normalizedUrl}`;
      merged.set(key, item);
    });

    // 2. Add fuzzy results, avoiding duplicates
    fuzzyResults.forEach((item) => {
      const normalizedUrl = this.normalizeUrl(item.url);
      const key = `${item.type}-${item.title}-${normalizedUrl}`;
      if (!merged.has(key)) {
        merged.set(key, item);
      }
    });

    return Array.from(merged.values());
  }

  normalizeUrl(url) {
    if (!url) return '';
    try {
      let u = url.toLowerCase().trim();
      u = u.replace(/^(https?:\/\/)?(www\.)?/, '');
      u = u.replace(/\/$/, ''); // Remove trailing slash
      return u;
    } catch {
      return url.toLowerCase();
    }
  }
}
export const hybridSearchEngine = new HybridSearchEngine();
