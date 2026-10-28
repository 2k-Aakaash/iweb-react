import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetIwebDBConnection, openIwebDB, STORES, txDone } from '../../wallpaper/db.js';
import { AvatarError, centerSquare, getAvatar, initialsOf, removeAvatar, setAvatarFromFile } from '../avatar.js';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetIwebDBConnection();
});

afterEach(() => {
  _resetIwebDBConnection();
});

describe('profile avatar', () => {
  it('crops the centred square of an image', () => {
    expect(centerSquare(400, 300)).toEqual({ sx: 50, sy: 0, side: 300 });
    expect(centerSquare(300, 500)).toEqual({ sx: 0, sy: 100, side: 300 });
    expect(centerSquare(256, 256)).toEqual({ sx: 0, sy: 0, side: 256 });
  });

  it('makes initials from the name', () => {
    expect(initialsOf('Grant User')).toBe('GU');
    expect(initialsOf('  ada   lovelace byron ')).toBe('AB');
    expect(initialsOf('BOT')).toBe('B');
    expect(initialsOf('')).toBe('');
  });

  it('reads and removes the stored photo', async () => {
    expect(await getAvatar()).toBeNull();
    const db = await openIwebDB();
    const tx = db.transaction(STORES.PROFILE, 'readwrite');
    tx.objectStore(STORES.PROFILE).put({ key: 'avatar', blob: new Blob(['img'], { type: 'image/webp' }), updatedAt: 1 });
    await txDone(tx);
    expect(await (await getAvatar()).text()).toBe('img');
    await removeAvatar();
    expect(await getAvatar()).toBeNull();
  });

  it('rejects files that are not images', async () => {
    await expect(setAvatarFromFile(new File(['x'], 'notes.txt', { type: 'text/plain' }))).rejects.toBeInstanceOf(AvatarError);
    await expect(setAvatarFromFile(null)).rejects.toBeInstanceOf(AvatarError);
  });
});
