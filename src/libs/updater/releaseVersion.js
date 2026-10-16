// Release version bumping for the release workflow (scripts/next-version.mjs).
//
//   commit message starts with "feat"  → minor  (v2.2 → v2.3)
//   "[major]" anywhere in a message     → major  (v2.3 → v3.0)
//   anything else ("fix", …)            → patch  (v2.3 → v2.3.1)
//
// The base is the latest iWeb release (its tag or name, whichever is newer: older
// releases look like "v2.2-build.5", and a tag renamed by hand keeps the build in the name).

const RELEASE_RE = /^(?:iweb\s+)?v(\d+)\.(\d+)(?:\.(\d+))?(?:-build\.(\d+))?$/i;

/** [major, minor, patch] or null. */
export function parseRelease(text) {
  const match = RELEASE_RE.exec((text || '').trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] || 0)] : null;
}

function newer(a, b) {
  if (!a) return b;
  if (!b) return a;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i] ? a : b;
  }
  return a;
}

/** 'major' | 'minor' | 'patch' from all commit messages in the push. */
export function bumpKind(messages) {
  const list = (Array.isArray(messages) ? messages : [messages]).filter(Boolean);
  if (list.some((m) => /\[major\]/i.test(m))) return 'major';
  if (list.some((m) => /^\s*feat(\(.+?\))?!?:/i.test(m) || /^\s*feat\b/i.test(m))) return 'minor';
  return 'patch';
}

/** "2.3" (patch 0 is dropped) or "2.3.1". */
export function formatVersion([major, minor, patch]) {
  return patch ? `${major}.${minor}.${patch}` : `${major}.${minor}`;
}

/**
 * Next version from the latest release's tag/name and the pushed commit messages.
 * Returns { version: '2.3', tag: 'v2.3', manifestVersion: '2.3.0', kind }.
 */
export function nextVersion({ latestTag = '', latestName = '', messages = [], fallback = '2.2' } = {}) {
  const base = newer(parseRelease(latestTag), parseRelease(latestName)) || parseRelease(`v${fallback}`);
  const kind = bumpKind(messages);
  let [major, minor, patch] = base;
  if (kind === 'major') [major, minor, patch] = [major + 1, 0, 0];
  else if (kind === 'minor') [minor, patch] = [minor + 1, 0];
  else patch += 1;
  const version = formatVersion([major, minor, patch]);
  return { version, tag: `v${version}`, manifestVersion: `${major}.${minor}.${patch}`, kind };
}
