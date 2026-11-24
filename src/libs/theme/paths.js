/** A theme package path made safe: forward slashes, no leading slash, no `.` / `..` segments. */
export function cleanPath(path) {
  if (typeof path !== 'string') return null;
  const parts = path.replace(/\\/g, '/').split('/').filter((p) => p !== '' && p !== '.');
  if (!parts.length || parts.some((p) => p === '..' || /[\0:]/.test(p))) return null;
  return parts.join('/');
}

export const extOf = (path) => (/\.([a-z0-9]+)$/i.exec(path)?.[1] || '').toLowerCase();
