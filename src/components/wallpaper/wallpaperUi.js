import { QuotaError } from '../../libs/wallpaper/quotaLimiter';
import { UnsplashError } from '../../libs/wallpaper/unsplashClient';
import { isQuotaExceededError } from '../../libs/wallpaper/repository';

// Stable selection / React key for a wallpaper, never an array index.
export const refKey = (ref) => `${ref.source}:${ref.id}`;

export const sameRef = (a, b) =>
  Boolean(a && b && a.source === b.source && String(a.id) === String(b.id));

export const plural = (count, singular, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

export function formatResetTime(resetsAt) {
  if (resetsAt === null || resetsAt === undefined) return '';
  const date = resetsAt instanceof Date ? resetsAt : new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function isAbortError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  return err instanceof UnsplashError && err.code === 'ABORTED';
}

const UNSPLASH_MESSAGES = {
  NOT_CONFIGURED: 'Unsplash is not set up. Add VITE_UNSPLASH_ACCESS_KEY to your .env file, then restart the dev server or rebuild.',
  UNAUTHORIZED: 'Unsplash rejected the access key. Check VITE_UNSPLASH_ACCESS_KEY in your .env file, then restart the dev server or rebuild.',
  RATE_LIMITED: 'Unsplash is receiving too many requests from this key right now. Please try again a little later.',
  NETWORK: 'Couldn’t reach Unsplash. Check your connection and try again.',
  OFFLINE: 'You’re offline. Only photos already saved on this device are available.',
  BAD_RESPONSE: 'Unsplash sent back something unexpected. Please try another photo.',
  SERVER: 'Unsplash is having trouble right now. Please try again later.',
  NOT_FOUND: 'No new Unsplash photos were found for this selection. Try other topics or a different keyword.',
  INVALID_QUERY: 'Enter a search term with letters or numbers.',
};

// Maps service errors to a short, user-facing sentence. Never exposes stack traces
// or raw technical messages. Returns '' for aborts, which are not user errors.
export function describeWallpaperError(err, { resetsAt } = {}) {
  if (!err || isAbortError(err)) return '';

  if (err instanceof QuotaError || err.name === 'QuotaError') {
    if (err.code === 'DAILY_LIMIT') {
      const time = formatResetTime(resetsAt ?? err.resetsAt);
      return `Today’s limit for new Unsplash photos is reached.${time ? ` New photos are available again at ${time}.` : ''} Photos you’ve already saved can still be used.`;
    }
    return 'The daily Unsplash allowance couldn’t be checked. Please try again.';
  }

  if (err instanceof UnsplashError || err.name === 'UnsplashError') {
    return UNSPLASH_MESSAGES[err.code] || 'Something went wrong while talking to Unsplash. Please try again.';
  }

  if (isQuotaExceededError(err)) {
    return 'Browser storage is full. Delete some wallpapers and try again.';
  }

  return 'Something went wrong. Please try again.';
}
