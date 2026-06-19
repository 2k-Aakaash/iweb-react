import Fuse from 'fuse.js';

export class FuseSearchEngine {
  constructor() {
    this.fuse = null;
  }

  initialize(items) {
    this.fuse = new Fuse(items, {
      keys: ['title', 'url', 'folder'],
      threshold: 0.3,
      distance: 100,
      ignoreLocation: true,
      includeScore: true,
      minMatchCharLength: 1
    });
  }

  search(query) {
    if (!this.fuse) return [];
    
    const hits = this.fuse.search(query);
    return hits.map((hit) => ({
      ...hit.item,
      matchType: 'fuzzy',
      score: hit.score ? 1 - hit.score : 0.5
    }));
  }
}
export const fuseSearchEngine = new FuseSearchEngine();
