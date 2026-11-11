// The Dock's bookmarks: [{ websiteName, url, favicon, order }], kept in localStorage
// ('bookmarks') and in App state. The name identifies a bookmark (the Dock keys by it), so
// names are unique, ignoring case. Every change goes through these helpers, from the Dock's
// Add App dialog and from Settings → Bookmarks, so both check the same things.
//
// Each helper returns { list } with the new list (orders renumbered), or { error } with a
// sentence to show.

export const STORAGE_KEY = 'bookmarks';

/** A full URL from what was typed: "reddit" → https://www.reddit.com, "x.com/home" → https://x.com/home. */
export function normalizeUrl(input) {
  let url = String(input || '').trim();
  if (!url) return null;
  if (/^(ftp|https?):\/\//i.test(url)) {
    // already absolute
  } else if (/^www\./i.test(url) || /^[^\s/]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(url)) {
    url = `https://${url}`;
  } else if (/^[a-z0-9-]+$/i.test(url)) {
    url = `https://www.${url}.com`; // a bare word, as the Dock always did
  } else {
    return null;
  }
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('.') ? parsed.href : null;
  } catch {
    return null;
  }
}

export function domainOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return String(url || '').replace(/^https?:\/\/|www\./g, '');
  }
}

const faviconFor = (url) => `https://www.google.com/s2/favicons?sz=256&domain_url=${url}`;
const renumber = (list) => list.map((b, i) => ({ ...b, order: i }));
const nameTaken = (list, name, except = -1) =>
  list.some((b, i) => i !== except && b.websiteName.trim().toLowerCase() === name.trim().toLowerCase());

function check(list, name, url, except = -1) {
  const cleanName = String(name || '').trim();
  if (!cleanName) return { error: 'Enter a name.' };
  if (cleanName.length > 40) return { error: 'Keep the name under 40 characters.' };
  if (nameTaken(list, cleanName, except)) return { error: `“${cleanName}” is already in the Dock.` };
  const fullUrl = normalizeUrl(url);
  if (!fullUrl) return { error: 'Enter a web address, like reddit.com.' };
  return { name: cleanName, url: fullUrl };
}

export function addBookmark(list, { name, url }) {
  const c = check(list, name, url);
  if (c.error) return c;
  return { list: renumber([...list, { websiteName: c.name, url: c.url, favicon: faviconFor(c.url), order: list.length }]) };
}

export function updateBookmark(list, index, { name, url }) {
  if (!list[index]) return { error: 'That bookmark is gone.' };
  const c = check(list, name, url, index);
  if (c.error) return c;
  const prev = list[index];
  const next = { ...prev, websiteName: c.name, url: c.url, favicon: c.url === prev.url ? prev.favicon : faviconFor(c.url) };
  return { list: renumber(list.map((b, i) => (i === index ? next : b))) };
}

export function removeBookmark(list, index) {
  return { list: renumber(list.filter((_, i) => i !== index)) };
}

/** Moves the bookmark at `from` to position `to`. */
export function moveBookmark(list, from, to) {
  if (from === to || !list[from] || to < 0 || to >= list.length) return { list };
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return { list: renumber(next) };
}

export function saveBookmarks(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage blocked: the change still shows until the page closes.
  }
}

// "Edit in Settings…" from the Dock's menu: Settings → Bookmarks opens on that bookmark.
let pendingEdit = null;
export function requestBookmarkEdit(name) {
  pendingEdit = name;
}
/** The bookmark index to edit on opening, or -1 (read-only: React may call it twice). */
export function peekBookmarkEdit(list) {
  return pendingEdit ? list.findIndex((b) => b.websiteName === pendingEdit) : -1;
}
export function clearBookmarkEdit() {
  pendingEdit = null;
}
