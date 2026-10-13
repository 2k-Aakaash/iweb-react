import 'fake-indexeddb/auto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { resolveObjectURL } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetIwebDBConnection } from '../db.js';
import { decodeImage, makeThumbnail } from '../imageLoader.js';
import { importLocalFiles, MAX_LOCAL_FILE_BYTES } from '../importManager.js';
import { listLocal } from '../repository.js';
import { subscribe } from '../sync.js';

vi.mock('../imageLoader.js', () => ({
  ACCEPTED_LOCAL_TYPES: ['image/jpeg', 'image/png', 'image/gif'],
  makeThumbnail: vi.fn(async () => new Blob(['thumb'], { type: 'image/webp' })),
  sha256Hex: vi.fn(async (blob) => {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }),
  // Simulates <img>.decode(): bytes starting with "CORRUPT" fail to decode.
  decodeImage: vi.fn(async (src) => {
    const blob = resolveObjectURL(src);
    if (!blob) throw new Error('object URL was revoked or never created');
    const text = await blob.text();
    if (text.startsWith('CORRUPT')) throw new Error('decode failed');
    return {};
  }),
}));

class MemoryStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(i) { return Array.from(this.map.keys())[i] ?? null; }
  getItem(k) { return this.map.has(String(k)) ? this.map.get(String(k)) : null; }
  setItem(k, v) { this.map.set(String(k), String(v)); }
  removeItem(k) { this.map.delete(String(k)); }
  clear() { this.map.clear(); }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
  writable: true,
});

const image = (name, content = name, type = 'image/jpeg') => new File([content], name, { type });

let events;
let unsubscribe;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetIwebDBConnection();
  localStorage.clear();
  vi.clearAllMocks();
  events = [];
  unsubscribe = subscribe((msg) => events.push(msg.type));
});

afterEach(() => {
  unsubscribe();
  vi.restoreAllMocks();
  _resetIwebDBConnection();
});

describe('importLocalFiles', () => {
  it('imports valid files with thumbnails, hashes and progress', async () => {
    const createSpy = vi.spyOn(URL, 'createObjectURL');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const progress = [];
    const files = [image('a.jpg'), image('b.png', 'b', 'image/png'), image('c.gif', 'c', 'image/gif')];

    const result = await importLocalFiles(files, { onProgress: (p) => progress.push(p) });

    expect(result.failed).toEqual([]);
    expect(result.duplicates).toEqual([]);
    expect(result.cancelled).toBe(false);
    expect(result.imported).toHaveLength(3);

    const records = await listLocal();
    expect(records.map((r) => r.name)).toEqual(['a.jpg', 'b.png', 'c.gif']);
    expect(records.map((r) => r.id)).toEqual(result.imported);
    records.forEach((r) => {
      expect(r.thumb).toBeInstanceOf(Blob);
      expect(r.blob).toBeInstanceOf(Blob);
    });
    expect(records[1].type).toBe('image/png');

    expect(progress[0]).toEqual({ done: 0, total: 3, current: null });
    expect(progress.at(-1)).toMatchObject({ done: 3, total: 3 });
    expect(progress).toHaveLength(4);

    // Every object URL used for the decode check is revoked.
    expect(decodeImage).toHaveBeenCalledTimes(3);
    expect(revokeSpy).toHaveBeenCalledTimes(createSpy.mock.calls.length);
    expect(revokeSpy.mock.calls.map((c) => c[0]).sort())
      .toEqual(createSpy.mock.results.map((r) => r.value).sort());

    expect(events.filter((t) => t === 'library-changed')).toHaveLength(1);
  });

  it('rejects unsupported types and empty files', async () => {
    const result = await importLocalFiles([
      image('doc.txt', 'hello', 'text/plain'),
      image('pic.webp', 'webp', 'image/webp'),
      image('empty.jpg', ''),
    ]);
    expect(result.imported).toEqual([]);
    expect(result.failed.map((f) => [f.name, f.code])).toEqual([
      ['doc.txt', 'UNSUPPORTED_TYPE'],
      ['pic.webp', 'UNSUPPORTED_TYPE'],
      ['empty.jpg', 'EMPTY'],
    ]);
    result.failed.forEach((f) => expect(typeof f.reason).toBe('string'));
    expect(events).toEqual([]);
  });

  it('infers the type from the extension when the browser gives none', async () => {
    const result = await importLocalFiles([new File(['x'], 'photo.JPG', { type: '' })]);
    expect(result.imported).toHaveLength(1);
    expect((await listLocal())[0].type).toBe('image/jpeg');
  });

  it('rejects files larger than 25 MB', async () => {
    const big = new File([new Uint8Array(MAX_LOCAL_FILE_BYTES + 1)], 'huge.jpg', { type: 'image/jpeg' });
    const result = await importLocalFiles([big]);
    expect(result.failed).toEqual([{ name: 'huge.jpg', code: 'TOO_LARGE', reason: expect.any(String) }]);
    expect(await listLocal()).toEqual([]);
  });

  it('rejects corrupted images through the decode check', async () => {
    const result = await importLocalFiles([image('broken.jpg', 'CORRUPT bytes')]);
    expect(result.imported).toEqual([]);
    expect(result.failed).toEqual([{ name: 'broken.jpg', code: 'INVALID_IMAGE', reason: expect.any(String) }]);
    expect(await listLocal()).toEqual([]);
  });

  it('uses an injected decode check', async () => {
    const decodeCheck = vi.fn(async (file) => {
      if (file.name === 'bad.jpg') throw new Error('nope');
    });
    const result = await importLocalFiles([image('good.jpg'), image('bad.jpg')], { decodeCheck });
    expect(decodeCheck).toHaveBeenCalledTimes(2);
    expect(decodeImage).not.toHaveBeenCalled();
    expect(result.imported).toHaveLength(1);
    expect(result.failed.map((f) => f.name)).toEqual(['bad.jpg']);
  });

  it('skips duplicates already in the library and within the batch', async () => {
    const first = await importLocalFiles([image('a.jpg', 'same-bytes')]);
    expect(first.imported).toHaveLength(1);

    const result = await importLocalFiles([
      image('a-copy.jpg', 'same-bytes'),
      image('b.jpg', 'other'),
      image('b-copy.jpg', 'other'),
      image('b-copy-2.jpg', 'other'),
    ], { concurrency: 4 });
    expect(result.duplicates).toEqual(['a-copy.jpg', 'b-copy.jpg', 'b-copy-2.jpg']);
    expect(result.imported).toHaveLength(1);
    expect(await listLocal()).toHaveLength(2);
  });

  it('shares the failure of the first copy with in-batch duplicates', async () => {
    const result = await importLocalFiles([
      image('x.jpg', 'CORRUPT x'),
      image('x-copy.jpg', 'CORRUPT x'),
    ], { concurrency: 2 });
    expect(result.duplicates).toEqual([]);
    expect(result.failed.map((f) => [f.name, f.code])).toEqual([
      ['x.jpg', 'INVALID_IMAGE'],
      ['x-copy.jpg', 'INVALID_IMAGE'],
    ]);
  });

  it('keeps going after individual failures (partial failure)', async () => {
    const result = await importLocalFiles([
      image('ok-1.jpg'),
      image('bad.txt', 'x', 'text/plain'),
      image('broken.jpg', 'CORRUPT'),
      image('ok-2.png', 'png', 'image/png'),
    ], { concurrency: 2 });
    expect(result.imported).toHaveLength(2);
    expect(result.failed.map((f) => f.name)).toEqual(['bad.txt', 'broken.jpg']);
    expect((await listLocal()).map((r) => r.name)).toEqual(expect.arrayContaining(['ok-1.jpg', 'ok-2.png']));
    expect(events.filter((t) => t === 'library-changed')).toHaveLength(1);
  });

  it('accepts a missing thumbnail', async () => {
    makeThumbnail.mockResolvedValueOnce(null);
    makeThumbnail.mockRejectedValueOnce(new Error('no canvas'));
    const result = await importLocalFiles([image('a.jpg'), image('b.jpg')], { concurrency: 1 });
    expect(result.imported).toHaveLength(2);
    (await listLocal()).forEach((r) => expect(r.thumb).toBeNull());
  });

  it('reports storage errors per file', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const result = await importLocalFiles([image('a.jpg'), image('b.jpg')], { concurrency: 1 });
    expect(result.failed).toEqual([{ name: 'a.jpg', code: 'STORAGE_FULL', reason: expect.any(String) }]);
    expect(result.imported).toHaveLength(1);
    expect((await listLocal()).map((r) => r.name)).toEqual(['b.jpg']);
  });

  it('stops starting new files when cancelled', async () => {
    const controller = new AbortController();
    const files = [image('1.jpg'), image('2.jpg'), image('3.jpg'), image('4.jpg')];
    const result = await importLocalFiles(files, {
      concurrency: 1,
      signal: controller.signal,
      onProgress: ({ done }) => {
        if (done === 1) controller.abort();
      },
    });
    expect(result.cancelled).toBe(true);
    expect(result.imported).toHaveLength(1);
    expect(result.failed).toEqual([]);
    expect(await listLocal()).toHaveLength(1);
    expect(events.filter((t) => t === 'library-changed')).toHaveLength(1);
  });

  it('does nothing when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await importLocalFiles([image('1.jpg')], { signal: controller.signal });
    expect(result).toEqual({ imported: [], duplicates: [], failed: [], cancelled: true });
    expect(events).toEqual([]);
  });

  it('handles an empty selection', async () => {
    expect(await importLocalFiles([])).toEqual({ imported: [], duplicates: [], failed: [], cancelled: false });
    expect(await importLocalFiles(null)).toEqual({ imported: [], duplicates: [], failed: [], cancelled: false });
  });
});
