import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeCreatorPrefs } from '../creatorPrefs.js';

// The app's code (everything under src/, which is what gets bundled) must never read the
// creator server's secrets: they exist only as Vercel environment variables, read by
// api/_creatorProxy.js. A VITE_-prefixed secret would be inlined into the bundle.
const SECRETS = ['GOOGLE_CLIENT_SECRET', 'CREATOR_TOKEN_KEY', 'YOUTUBE_API_KEY', 'GOOGLE_CLIENT_ID'];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : files(path);
    return /\.(jsx?|css)$/.test(name) ? [path] : [];
  });
}

describe('frontend code', () => {
  it('never references the creator server’s secrets or process.env', () => {
    const offenders = files('src').filter((path) => {
      const text = readFileSync(path, 'utf8');
      return text.includes('process.env') || SECRETS.some((name) => text.includes(name));
    });
    expect(offenders).toEqual([]);
  });

  it('never logs creator grants or tokens', () => {
    const creator = files('src/libs/creator').concat(files('src/components/creator'));
    for (const path of creator) {
      const text = readFileSync(path, 'utf8');
      expect(text, path).not.toMatch(/console\.\w+\([^)]*(grant|token)/i);
    }
  });
});

describe('creator prefs', () => {
  it('accept only valid account ids and refresh intervals', () => {
    expect(normalizeCreatorPrefs({ youtube: 'youtube:UC1', refreshMinutes: 7 }))
      .toEqual({ youtube: 'youtube:UC1', refreshMinutes: 30 });
    expect(normalizeCreatorPrefs({ youtube: '<script>', refreshMinutes: 0 })).toEqual({ youtube: null, refreshMinutes: 0 });
    // Saved before Instagram Analytics was removed: its choice is dropped.
    expect(normalizeCreatorPrefs({ youtube: 'instagram:17840', instagram: 'instagram:17840', refreshMinutes: 30 }))
      .toEqual({ youtube: null, refreshMinutes: 30 });
    expect(normalizeCreatorPrefs(null)).toBeNull();
  });
});
