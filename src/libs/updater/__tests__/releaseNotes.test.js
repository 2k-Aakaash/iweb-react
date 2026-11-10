import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commitSubject, composeNotes, sourceFromBody } from '../../../../scripts/release-notes.mjs';

const NOTES_DIR = new URL('../../../../docs/releases/', import.meta.url);
const SOURCE = { sha: '7387643abcdef', url: 'https://github.com/2k-Aakaash/iweb-react/commit/7387643abcdef' };

describe('release notes', () => {
  it('uses the written notes, then the install note and the source commit', () => {
    const body = composeNotes({ tag: 'v2.11.4', notes: '# iWeb v2.11.4\n\n## Fixes\n- A fix.\n\n', source: SOURCE });
    expect(body.startsWith('# iWeb v2.11.4\n\n## Fixes\n- A fix.\n\n---\n**Install:**')).toBe(true);
    expect(body).toContain('[iweb-react@7387643](https://github.com/2k-Aakaash/iweb-react/commit/7387643abcdef)');
  });

  it('lists the commits when a release has no notes file', () => {
    const body = composeNotes({ tag: 'v2.12', kind: 'minor', messages: ['feat: Spaces\n\nbody text', 'fix(dock): icons [major]', 'Merge branch x'] });
    expect(body).toContain('# iWeb v2.12\n\nMinor release.\n\n## Changes\n- Spaces\n- icons\n\n---');
    expect(body).not.toContain('body text');
    expect(body).not.toContain('Merge');
  });

  it('keeps the source link of an earlier release when its notes are rewritten', () => {
    const old = 'patch release · automated build of [iweb-react@7387643](https://github.com/2k-Aakaash/iweb-react/commit/7387643abcdef).\n\nInstall: …';
    expect(sourceFromBody(old)).toEqual({ sha: '7387643', url: 'https://github.com/2k-Aakaash/iweb-react/commit/7387643abcdef' });
    expect(sourceFromBody('no link')).toBe(null);
    expect(commitSubject('Sticky cards: colours')).toBe('Sticky cards: colours');
  });

  it('has a well-formed notes file for each release', () => {
    const files = readdirSync(NOTES_DIR).filter((f) => f.endsWith('.md'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const tag = file.slice(0, -3);
      expect(tag).toMatch(/^v\d+\.\d+(\.\d+)?$/);
      const text = readFileSync(new URL(file, NOTES_DIR), 'utf8');
      expect(text.startsWith(`# iWeb ${tag}`), file).toBe(true);
      expect(text, file).toMatch(/\n## /);
    }
  });
});
