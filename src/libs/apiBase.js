// Resolves URLs for the app's own serverless API (/api/* on Vercel, Vite middleware in dev).
//
// The website and dev server call it same-origin. The browser extension runs on
// chrome-extension://, so it needs the deployed origin: VITE_API_ORIGIN sets it explicitly;
// otherwise it is taken from VITE_UNSPLASH_PROXY_URL (already set for extension builds),
// so no new build variable is required.

function readEnv(name) {
  const value = import.meta.env?.[name];
  return typeof value === 'string' ? value.trim() : '';
}

function absoluteOrigin(value) {
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function getApiOrigin() {
  const explicit = absoluteOrigin(readEnv('VITE_API_ORIGIN'));
  if (explicit) return explicit;
  if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) return location.origin;
  return absoluteOrigin(readEnv('VITE_UNSPLASH_PROXY_URL'));
}

/** Absolute URL for an API path (e.g. '/api/market'), or null when no origin is known. */
export function apiUrl(path) {
  const origin = getApiOrigin();
  return origin ? new URL(path, origin) : null;
}
