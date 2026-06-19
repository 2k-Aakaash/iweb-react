import { Client } from 'typesense';

export class TypesenseService {
  constructor() {
    this.client = null;
    this.isEnabled = false;
    this.initialize();
  }

  /**
   * Initializes Typesense client from potential local configuration.
   */
  initialize(config) {
    if (config) {
      this.client = new Client({
        nodes: [{
          host: config.host,
          port: config.port,
          protocol: config.protocol
        }],
        apiKey: config.apiKey,
        connectionTimeoutSeconds: 2
      });
      this.isEnabled = true;
      console.log('Typesense semantic search service enabled.');
    } else {
      // Gracefully disabled by default unless specified
      this.isEnabled = false;
      this.client = null;
    }
  }

  /**
   * Checks if Typesense is initialized and enabled.
   */
  isServiceEnabled() {
    return this.isEnabled && this.client !== null;
  }

  /**
   * Performs semantic/vector search on a queries collection.
   */
  async search(
    query,
    collectionName = 'browser_search_items',
    options = {}
  ) {
    if (!this.isEnabled || !this.client) return [];

    try {
      const searchParameters = {
        q: query,
        query_by: 'title,url,description,embedding', // embedding is used if vector search is enabled
        prefix: true,
        sort_by: '_text_match:desc',
        facet_by: options.facets || '',
        filter_by: options.filterBy || ''
      };

      const searchResults = await this.client
        .collections(collectionName)
        .documents()
        .search(searchParameters);

      if (!searchResults.hits) return [];

      return searchResults.hits.map((hit) => {
        const doc = hit.document;
        // Invert vector/match score
        const score = hit.vector_distance !== undefined ? 1 - hit.vector_distance : 0.8;
        return {
          id: `typesense-${doc.id}`,
          title: doc.title,
          url: doc.url || '',
          type: 'typesense',
          score,
          matchType: 'semantic'
        };
      });
    } catch (e) {
      console.error('Typesense search failed:', e);
      return [];
    }
  }

  /**
   * Executes multiple search requests in a single round-trip.
   */
  async multiSearch(
    searches,
    commonParams = {}
  ) {
    if (!this.isEnabled || !this.client) return [];

    try {
      const requests = searches.map(s => ({
        collection: s.collection,
        q: s.q,
        query_by: 'title,url'
      }));

      const res = await this.client.multiSearch.perform({ searches: requests }, commonParams);
      
      return (res.results || []).map((result) => {
        if (!result.hits) return [];
        return result.hits.map((hit) => {
          const doc = hit.document;
          return {
            id: `typesense-${doc.id}`,
            title: doc.title,
            url: doc.url || '',
            type: 'typesense',
            score: 0.7,
            matchType: 'semantic'
          };
        });
      });
    } catch (e) {
      console.error('Typesense multiSearch failed:', e);
      return [];
    }
  }

  /**
   * Manages schema synonyms configurations.
   */
  async manageSynonyms(
    collectionName,
    synonymId,
    synonyms
  ) {
    if (!this.isEnabled || !this.client) return false;

    try {
      await this.client
        .collections(collectionName)
        .synonyms()
        .upsert(synonymId, { synonyms });
      return true;
    } catch (e) {
      console.error('Typesense synonyms update failed:', e);
      return false;
    }
  }
}
export const typesenseService = new TypesenseService();
