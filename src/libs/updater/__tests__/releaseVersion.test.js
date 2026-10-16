import { describe, expect, it } from 'vitest';
import { bumpKind, nextVersion, parseRelease } from '../releaseVersion.js';

describe('release versions', () => {
  it('parses current and legacy tags/names', () => {
    expect(parseRelease('v2.3')).toEqual([2, 3, 0]);
    expect(parseRelease('v2.3.1')).toEqual([2, 3, 1]);
    expect(parseRelease('v2.2-build.5')).toEqual([2, 2, 0]);
    expect(parseRelease('iWeb v2.4')).toEqual([2, 4, 0]);
    expect(parseRelease('v2.0.2alpha')).toBeNull();
  });

  it('picks the bump from commit messages', () => {
    expect(bumpKind(['feat: markets app'])).toBe('minor');
    expect(bumpKind(['feat(widgets): gold card'])).toBe('minor');
    expect(bumpKind(['fix: typo', 'feat: new'])).toBe('minor');
    expect(bumpKind(['fix: chart labels'])).toBe('patch');
    expect(bumpKind(['Update README'])).toBe('patch');
    expect(bumpKind(['feat: redesign [major]'])).toBe('major');
  });

  it('bumps from the latest release', () => {
    expect(nextVersion({ latestTag: 'v2.2-build.5', messages: ['feat: x'] })).toMatchObject({ tag: 'v2.3', manifestVersion: '2.3.0' });
    expect(nextVersion({ latestTag: 'v2.3', messages: ['fix: y'] })).toMatchObject({ tag: 'v2.3.1', manifestVersion: '2.3.1' });
    expect(nextVersion({ latestTag: 'v2.3.1', messages: ['feat: z'] }).tag).toBe('v2.4');
    expect(nextVersion({ latestTag: 'v2.4', messages: ['[major] new UI'] }).tag).toBe('v3.0');
    // Hand-renamed tag: the name carries the newer version.
    expect(nextVersion({ latestTag: 'v2.2', latestName: 'iWeb v2.2.4', messages: ['fix'] }).tag).toBe('v2.2.5');
    // No usable release yet.
    expect(nextVersion({ latestTag: '', messages: ['feat: x'], fallback: '2.2' }).tag).toBe('v2.3');
  });
});
