// What someone typed to find a public YouTube channel: an @handle, a channel ID (UC…) or a
// channel URL. Shared by the Creator widgets' "Add Channel" field and the server proxy
// (api/_creatorProxy.js), which validates again before calling YouTube.
//
// Custom URLs (youtube.com/c/Name) can't be resolved by channels.list (only by search.list,
// which costs 100× the quota and can return the wrong channel), so they ask for the handle.

const ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
// YouTube handles: 3–30 letters (any script), digits, underscores, hyphens and periods.
const HANDLE_RE = /^[\p{L}\p{N}._-]{3,30}$/u;
// Legacy usernames (youtube.com/user/Name).
const USERNAME_RE = /^[A-Za-z0-9]{1,40}$/;
const MAX_INPUT = 200;

const handle = (value) => (HANDLE_RE.test(value) ? { kind: 'handle', value: `@${value}` } : null);

function fromUrl(text) {
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'youtube.com' && !host.endsWith('.youtube.com')) return null;
  let parts;
  try {
    parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return { error: 'That link isn’t a valid YouTube channel address.' };
  }
  const [first = '', second = ''] = parts;
  if (first.startsWith('@')) return handle(first.slice(1)) || { error: 'That link has an invalid @handle.' };
  if (first === 'channel' && ID_RE.test(second)) return { kind: 'id', value: second };
  if (first === 'user' && USERNAME_RE.test(second)) return { kind: 'username', value: second };
  if (first === 'c') return { error: 'Custom links (youtube.com/c/…) can’t be looked up. Use the channel’s @handle instead.' };
  return { error: 'That link isn’t a YouTube channel. Use its @handle, channel ID or channel link.' };
}

/**
 * { kind: 'id' | 'handle' | 'username', value } for a channel to look up, or { error }.
 * Handles come back with their "@".
 */
export function parseChannelInput(input) {
  const text = String(input ?? '').trim();
  if (!text) return { error: 'Enter a channel’s @handle, ID or link.' };
  if (text.length > MAX_INPUT) return { error: 'That’s too long for a channel handle or link.' };
  if (ID_RE.test(text)) return { kind: 'id', value: text };
  if (/youtube\.com/i.test(text) || /^[a-z]+:\/\//i.test(text)) {
    return fromUrl(text) || { error: 'That link isn’t a YouTube channel. Use its @handle, channel ID or channel link.' };
  }
  return handle(text.startsWith('@') ? text.slice(1) : text)
    || { error: 'That isn’t a valid @handle. Handles are 3–30 letters, numbers, periods, hyphens or underscores.' };
}
