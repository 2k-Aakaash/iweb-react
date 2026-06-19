import { Index } from 'flexsearch';

export class FlexSearchEngine {
  constructor() {
    this.index = new Index({
      tokenize: 'forward',
      resolution: 9
    });
    this.items = [];
  }

  initialize(items) {
    this.items = items;
    this.index = new Index({
      tokenize: 'forward',
      resolution: 9
    });

    items.forEach((item, idx) => {
      const textToSearch = `${item.title} ${item.url}`.toLowerCase();
      this.index.add(idx, textToSearch);
    });
  }

  search(query, limit = 50) {
    const hits = this.index.search(query.toLowerCase(), limit);
    return hits
      .map((hit) => {
        const idx = typeof hit === 'string' ? parseInt(hit, 10) : hit;
        if (!isNaN(idx) && idx >= 0 && idx < this.items.length) {
          return { ...this.items[idx], matchType: 'prefix' };
        }
        return null;
      })
      .filter((item) => item !== null);
  }
}
export const flexSearchEngine = new FlexSearchEngine();
