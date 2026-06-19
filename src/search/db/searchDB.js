import Dexie from 'dexie';

export class SearchDatabase extends Dexie {
  constructor() {
    super('browser_search_db');
    this.version(1).stores({
      searches: '++id, query, normalized, count, lastUsed, avgSelection',
      suggestions: '++id, text, normalized, score, source, lastUsed, clickCount',
      clicks: '++id, query, clickedId, clickedUrl, position, timestamp, dwellTime',
      history: '++id, title, url, icon, visitCount, lastVisit',
      bookmarks: '++id, title, url, folder, createdAt, isFavorite'
    });
  }
}

export const db = new SearchDatabase();

// Seed initial mock data if empty
export async function seedDatabase() {
  const bookmarkCount = await db.bookmarks.count();
  if (bookmarkCount === 0) {
    console.log('Seeding initial search data...');
    
    // Seed Bookmarks
    await db.bookmarks.bulkAdd([
      { title: 'GitHub', url: 'https://github.com', folder: 'Development', createdAt: Date.now() - 30 * 24 * 3600 * 1000, isFavorite: true },
      { title: 'Google', url: 'https://google.com', folder: 'Search', createdAt: Date.now() - 60 * 24 * 3600 * 1000, isFavorite: true },
      { title: 'YouTube', url: 'https://youtube.com', folder: 'Entertainment', createdAt: Date.now() - 90 * 24 * 3600 * 1000 },
      { title: 'Gmail', url: 'https://mail.google.com', folder: 'Productivity', createdAt: Date.now() - 100 * 24 * 3600 * 1000, isFavorite: true },
      { title: 'React Documentation', url: 'https://react.dev', folder: 'Development', createdAt: Date.now() - 15 * 24 * 3600 * 1000 },
      { title: 'Vite Native Bundler', url: 'https://vite.dev', folder: 'Development', createdAt: Date.now() - 10 * 24 * 3600 * 1000 },
      { title: 'Stack Overflow', url: 'https://stackoverflow.com', folder: 'Development', createdAt: Date.now() - 120 * 24 * 3600 * 1000 },
      { title: 'Typesense Vector Search', url: 'https://typesense.org', folder: 'Search', createdAt: Date.now() - 25 * 24 * 3600 * 1000 },
      { title: 'Dexie IndexedDB Library', url: 'https://dexie.org', folder: 'Search', createdAt: Date.now() - 5 * 24 * 3600 * 1000 },
      { title: 'FlexSearch Full-Text Search', url: 'https://github.com/nextapps-de/flexsearch', folder: 'Development', createdAt: Date.now() - 12 * 24 * 3600 * 1000 }
    ]);

    // Seed History
    await db.history.bulkAdd([
      { title: 'GitHub Issues', url: 'https://github.com/issues', visitCount: 45, lastVisit: Date.now() - 2 * 3600 * 1000 },
      { title: 'GitLab', url: 'https://gitlab.com', visitCount: 8, lastVisit: Date.now() - 1 * 24 * 3600 * 1000 },
      { title: 'Google Maps', url: 'https://maps.google.com', visitCount: 15, lastVisit: Date.now() - 5 * 3600 * 1000 },
      { title: 'Spotify Web Player', url: 'https://open.spotify.com', visitCount: 30, lastVisit: Date.now() - 4 * 3600 * 1000 },
      { title: 'React Hooks API Reference', url: 'https://react.dev/reference/react/hooks', visitCount: 22, lastVisit: Date.now() - 20 * 60 * 1000 },
      { title: 'Vite Guide', url: 'https://vite.dev/guide/', visitCount: 18, lastVisit: Date.now() - 3 * 24 * 3600 * 1000 },
      { title: 'Gemini Chatbot', url: 'https://gemini.google.com', visitCount: 50, lastVisit: Date.now() - 10 * 60 * 1000 },
      { title: 'Reddit Home', url: 'https://reddit.com', visitCount: 65, lastVisit: Date.now() - 8 * 3600 * 1000 },
      { title: 'ChatGPT', url: 'https://chatgpt.com', visitCount: 80, lastVisit: Date.now() - 5 * 60 * 1000 }
    ]);

    // Seed Search History
    await db.searches.bulkAdd([
      { query: 'git', normalized: 'git', count: 50, lastUsed: Date.now() - 1 * 24 * 3600 * 1000, avgSelection: 0 },
      { query: 'github', normalized: 'github', count: 45, lastUsed: Date.now() - 2 * 3600 * 1000, avgSelection: 0 },
      { query: 'react', normalized: 'react', count: 35, lastUsed: Date.now() - 20 * 60 * 1000, avgSelection: 1 },
      { query: 'google', normalized: 'google', count: 28, lastUsed: Date.now() - 5 * 3600 * 1000, avgSelection: 0 },
      { query: 'spotify', normalized: 'spotify', count: 20, lastUsed: Date.now() - 4 * 3600 * 1000, avgSelection: 0 }
    ]);

    // Seed Suggestions
    await db.suggestions.bulkAdd([
      { text: 'Github', normalized: 'github', score: 0.95, source: 'history', lastUsed: Date.now(), clickCount: 90 },
      { text: 'Gmail', normalized: 'gmail', score: 0.85, source: 'bookmark', lastUsed: Date.now(), clickCount: 40 },
      { text: 'Google', normalized: 'google', score: 0.9, source: 'bookmark', lastUsed: Date.now(), clickCount: 80 },
      { text: 'Google Maps', normalized: 'google maps', score: 0.75, source: 'history', lastUsed: Date.now(), clickCount: 20 },
      { text: 'Gitlab', normalized: 'gitlab', score: 0.7, source: 'history', lastUsed: Date.now(), clickCount: 8 },
      { text: 'Gemini', normalized: 'gemini', score: 0.88, source: 'history', lastUsed: Date.now(), clickCount: 55 },
      { text: 'React', normalized: 'react', score: 0.92, source: 'bookmark', lastUsed: Date.now(), clickCount: 75 },
      { text: 'React Router', normalized: 'react router', score: 0.65, source: 'web', lastUsed: Date.now(), clickCount: 15 },
      { text: 'React Query', normalized: 'react query', score: 0.7, source: 'web', lastUsed: Date.now(), clickCount: 18 },
      { text: 'React Hooks', normalized: 'react hooks', score: 0.8, source: 'history', lastUsed: Date.now(), clickCount: 30 },
      { text: 'React Context', normalized: 'react context', score: 0.6, source: 'web', lastUsed: Date.now(), clickCount: 5 }
    ]);

    // Seed Clicks
    await db.clicks.bulkAdd([
      { query: 'git', clickedId: 'GitHub', clickedUrl: 'https://github.com', position: 0, timestamp: Date.now() - 1 * 24 * 3600 * 1000, dwellTime: 320 },
      { query: 'git', clickedId: 'GitLab', clickedUrl: 'https://gitlab.com', position: 1, timestamp: Date.now() - 2 * 24 * 3600 * 1000, dwellTime: 45 },
      { query: 'g', clickedId: 'Google', clickedUrl: 'https://google.com', position: 0, timestamp: Date.now() - 3 * 24 * 3600 * 1000, dwellTime: 600 }
    ]);

    console.log('Database seeded successfully.');
  }
}
