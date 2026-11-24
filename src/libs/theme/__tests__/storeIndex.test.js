import { describe, expect, it } from 'vitest';
import { StoreError, updatesFor, validateIndex } from '../storeIndex.js';

const sha = 'a'.repeat(64);
const entry = (over = {}) => ({
  id: 'paper-ink', name: 'Paper & Ink', version: '1.2.0', author: 'Someone', sha256: sha,
  zip: 'paper-ink-1.2.0.zip', previews: ['paper-ink-1.png'], appearance: 'dark', size: 1000, ...over,
});
const assets = new Set(['index.json', 'paper-ink-1.2.0.zip', 'paper-ink-1.png', 'other-1.0.0.zip']);

describe('validateIndex', () => {
  it('keeps complete entries and cleans their text', () => {
    const { themes } = validateIndex({ format: 1, themes: [entry({ name: '<i>Paper</i>', tags: ['warm', 'serif'] })] }, assets);
    expect(themes).toHaveLength(1);
    expect(themes[0]).toMatchObject({ id: 'paper-ink', name: 'iPaper/i', version: '1.2.0', previews: ['paper-ink-1.png'], tags: ['warm', 'serif'] });
  });

  it('drops entries that are incomplete, unsafe or point at missing assets', () => {
    const bad = [
      entry({ id: 'Bad Id' }),
      entry({ id: 'iweb' }),
      entry({ id: 'v1', version: '1.0' }),
      entry({ id: 'v2', sha256: 'nope' }),
      entry({ id: 'v3', zip: 'missing.zip' }),
      entry({ id: 'v4', zip: '../evil.zip' }),
      entry({ id: 'v5', name: '' }),
      entry(), // kept
      entry(), // a duplicate id
    ];
    const { themes } = validateIndex({ format: 1, themes: bad }, assets);
    expect(themes.map((t) => t.id)).toEqual(['paper-ink']);
  });

  it('drops preview names that are not assets', () => {
    const { themes } = validateIndex({ format: 1, themes: [entry({ previews: ['paper-ink-1.png', 'https://evil.test/x.png', 'nope.png'] })] }, assets);
    expect(themes[0].previews).toEqual(['paper-ink-1.png']);
  });

  it('refuses a catalogue in another format', () => {
    expect(() => validateIndex({ format: 2, themes: [] }, assets)).toThrow(StoreError);
    expect(() => validateIndex(null, assets)).toThrow(StoreError);
  });
});

describe('updatesFor', () => {
  it('lists store themes newer than the installed ones', () => {
    const store = { themes: [entry(), entry({ id: 'other', version: '1.0.0', zip: 'other-1.0.0.zip' })] };
    const installed = [{ id: 'paper-ink', version: '1.1.9' }, { id: 'other', version: '1.0.0' }];
    expect(updatesFor(store, installed).map((t) => t.id)).toEqual(['paper-ink']);
    expect(updatesFor(null, installed)).toEqual([]);
  });
});
