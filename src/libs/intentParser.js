import { WordTokenizer } from './natural';

const INTENTS = {
  CREATE_PLAYLIST: "create_playlist",
  FIND_SONGS: "find_songs",
  PLAY_ARTIST: "play_artist",
  SHOW_PLAYLIST: "show_playlist",
  SHOW_FAVORITES: "show_favorites"
};

const patterns = {
  show_favorites: [
    /show.*favorites/i,
    /open.*favorites/i,
    /view.*favorites/i,
    /go.*favorites/i
  ],
  show_playlist: [
    /show.*playlist/i,
    /open.*playlist/i,
    /view.*playlist/i
  ],
  create_playlist: [
    /create.*playlist/i,
    /make.*playlist/i,
    /generate.*playlist/i
  ],
  find_songs: [
    /songs.*by/i,
    /find.*songs/i,
    /tracks.*by/i,
    /music.*by/i
  ],
  play_artist: [
    /play/i,
    /start playing/i
  ]
};

// Words to remove when extracting the target name (artist name or playlist name)
const STOP_WORDS = new Set([
  'create', 'make', 'generate', 'playlist', 'songs', 'tracks', 
  'music', 'play', 'start', 'playing', 'show', 'open', 'view', 
  'go', 'to', 'favorites', 'in', 'the', 'artist', 'name', 'of', 
  'for', 'by', 'from', 'a', 'an'
]);

export function parseSearchIntent(query) {
  if (!query) return null;

  const trimmed = query.trim();
  const tokenizer = new WordTokenizer();
  const tokens = tokenizer.tokenize(trimmed);

  // If no tokens or if it's just a raw search without command keywords
  const hasCommandWord = tokens.some(token => STOP_WORDS.has(token));
  if (!hasCommandWord) {
    return {
      intent: INTENTS.FIND_SONGS,
      artist: trimmed,
      raw: query
    };
  }

  // Detect intent based on patterns
  let detectedIntent = null;
  for (const [intent, regexes] of Object.entries(patterns)) {
    for (const regex of regexes) {
      if (regex.test(trimmed)) {
        detectedIntent = intent;
        break;
      }
    }
    if (detectedIntent) break;
  }

  // Fallback if command word is found but no regex matched
  if (!detectedIntent) {
    detectedIntent = INTENTS.FIND_SONGS;
  }

  // Extract entity by removing stop words from the tokens list
  const remainingTokens = tokens.filter(token => !STOP_WORDS.has(token));
  const entity = remainingTokens.join(' ');

  const result = {
    intent: detectedIntent,
    raw: query
  };

  if (detectedIntent === INTENTS.CREATE_PLAYLIST || detectedIntent === INTENTS.FIND_SONGS || detectedIntent === INTENTS.PLAY_ARTIST) {
    result.artist = entity;
  } else if (detectedIntent === INTENTS.SHOW_PLAYLIST) {
    result.playlistName = entity;
  }

  return result;
}
