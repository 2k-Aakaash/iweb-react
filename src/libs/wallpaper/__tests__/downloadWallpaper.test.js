import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../unsplashClient.js', () => ({ trackDownload: vi.fn() }));

const { _resetIwebDBConnection } = await import('../db.js');
const { addLocalRecord, putUnsplash } = await import('../repository.js');
const { trackDownload } = await import('../unsplashClient.js');
const { downloadWallpaper, localFileName, slugify, unsplashFileName } = await import('../downloadWallpaper.js');

const photo = {
  photoId: 'AbC_123',
  blob: new Blob(['cached'], { type: 'image/webp' }),
  photographer: { name: 'Ásh Saribekyan', username: 'ashs' },
  urls: { raw: 'https://images.unsplash.com/photo-1?ixid=x', full: 'https://images.unsplash.com/photo-1?full' },
  downloadLocation: 'https://api.unsplash.com/photos/AbC_123/download?ixid=x',
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetIwebDBConnection();
  trackDownload.mockReset();
  globalThis.fetch = vi.fn(async () => new Response(new Blob(['original'], { type: 'image/jpeg' })));
});

afterEach(() => {
  _resetIwebDBConnection();
  delete globalThis.fetch;
});

describe('downloadWallpaper', () => {
  it('names files the way Unsplash does', () => {
    expect(slugify('Ásh  Saribekyan!')).toBe('ash-saribekyan');
    expect(unsplashFileName(photo, 'image/jpeg')).toBe('ash-saribekyan-AbC_123-unsplash.jpg');
    expect(unsplashFileName({ photoId: 'x1', photographer: { username: 'only.user' } }, 'image/png')).toBe('only-user-x1-unsplash.png');
    expect(localFileName({ id: 4, name: 'My:Car?.JPG' }, 'image/jpeg')).toBe('My Car.jpg');
    expect(localFileName({ id: 4 }, 'image/gif')).toBe('iweb-wallpaper-4.gif');
  });

  it('reports the Unsplash download and saves the full-size original', async () => {
    await putUnsplash(photo);
    trackDownload.mockResolvedValue('https://images.unsplash.com/photo-1?ixid=x&dl=1');
    const save = vi.fn();
    const name = await downloadWallpaper({ source: 'unsplash', id: 'AbC_123' }, { save, online: () => true });
    expect(trackDownload).toHaveBeenCalledWith(photo.downloadLocation, expect.anything());
    expect(fetch).toHaveBeenCalledWith('https://images.unsplash.com/photo-1?ixid=x&dl=1', expect.anything());
    expect(name).toBe('ash-saribekyan-AbC_123-unsplash.jpg');
    expect(await save.mock.calls[0][0].text()).toBe('original');
    expect(save.mock.calls[0][1]).toBe(name);
  });

  it('saves nothing offline, since Unsplash must be told about the download', async () => {
    await putUnsplash(photo);
    const save = vi.fn();
    await expect(downloadWallpaper({ source: 'unsplash', id: 'AbC_123' }, { save, online: () => false }))
      .rejects.toMatchObject({ code: 'OFFLINE' });
    expect(trackDownload).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('saves a local image under its own name', async () => {
    const id = await addLocalRecord({ blob: new Blob(['png'], { type: 'image/png' }), name: 'sunset.png', type: 'image/png' });
    const save = vi.fn();
    const name = await downloadWallpaper({ source: 'local', id }, { save });
    expect(name).toBe('sunset.png');
    expect(await save.mock.calls[0][0].text()).toBe('png');
    expect(trackDownload).not.toHaveBeenCalled();
  });
});
