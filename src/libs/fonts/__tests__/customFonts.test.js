import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetIwebDBConnection, openIwebDB, STORES, txDone } from '../../wallpaper/db.js';
import { deleteCustomFonts, listCustomFonts } from '../customFonts.js';

const font = (family) => ({ family, name: family.replace('custom_', ''), blob: new Blob(['font'], { type: 'font/woff2' }) });

async function seed(...families) {
  const db = await openIwebDB();
  const tx = db.transaction(STORES.FONTS, 'readwrite');
  families.forEach((family) => tx.objectStore(STORES.FONTS).put(font(family)));
  await txDone(tx);
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetIwebDBConnection();
});

afterEach(() => {
  _resetIwebDBConnection();
});

describe('custom fonts', () => {
  it('lists the uploaded fonts', async () => {
    expect(await listCustomFonts()).toEqual([]);
    await seed('custom_a', 'custom_b');
    expect((await listCustomFonts()).map((f) => f.family)).toEqual(['custom_a', 'custom_b']);
  });

  it('deletes one or several fonts and returns them', async () => {
    await seed('custom_a', 'custom_b', 'custom_c');
    expect(await deleteCustomFonts(['custom_a'])).toEqual(['custom_a']);
    expect(await deleteCustomFonts(['custom_b', 'custom_c', 'custom_b'])).toEqual(['custom_b', 'custom_c']);
    expect(await listCustomFonts()).toEqual([]);
  });

  it('ignores an empty or invalid selection', async () => {
    await seed('custom_a');
    expect(await deleteCustomFonts([])).toEqual([]);
    expect(await deleteCustomFonts([null, ''])).toEqual([]);
    expect(await listCustomFonts()).toHaveLength(1);
  });
});
