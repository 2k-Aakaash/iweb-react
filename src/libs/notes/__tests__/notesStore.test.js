import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetNotesStore,
  createNote,
  deleteNote,
  ensureLoaded,
  getNote,
  getNotesState,
  normalizeNote,
  registerFlush,
  reloadNotes,
  updateContent,
  updateNote,
} from '../notesStore.js';
import { parseTasks, refOf, toggleChecked } from '../tasks.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

// Notes as the previous iWeb wrote them (no createdAt, kind or pinned).
const LEGACY = [
  { id: 1, title: 'Groceries', content: '- [ ] milk\n- [x] eggs', updatedAt: 1700000000000 },
  { id: 2, title: 'Ideas', content: '# Big idea\n\nSome **bold** text.', updatedAt: 1700000500000 },
];

function seed(records) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('iweb-notes-db', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('notes', 'readwrite');
      for (const r of records) tx.objectStore('notes').put(r);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

function rawRecords() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('iweb-notes-db', 1);
    req.onsuccess = () => {
      const db = req.result;
      const get = db.transaction('notes').objectStore('notes').getAll();
      get.onsuccess = () => {
        db.close();
        resolve(get.result);
      };
    };
    req.onerror = () => reject(req.error);
  });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  globalThis.localStorage = new MemoryStorage();
  _resetNotesStore();
});

afterEach(() => {
  _resetNotesStore();
  vi.useRealTimers();
});

describe('notes store', () => {
  it('loads notes from before the upgrade without rewriting them', async () => {
    await seed(LEGACY);
    await ensureLoaded();
    expect(getNotesState().status).toBe('ready');
    expect(getNotesState().notes.map((n) => n.id).sort()).toEqual([1, 2]);
    expect(await rawRecords()).toEqual(LEGACY); // byte-for-byte: nothing written on load
    // Loading again (another tab, a reload) changes nothing either.
    await reloadNotes();
    expect(await rawRecords()).toEqual(LEGACY);
  });

  it('moves notes from the old localStorage format once', async () => {
    localStorage.setItem('notes', JSON.stringify(['First line\nmore', '', 'Second']));
    await ensureLoaded();
    expect(getNotesState().notes.map((n) => n.title).sort()).toEqual(['First line', 'Second']);
    expect(localStorage.getItem('notes')).toBe(null);
    await reloadNotes();
    expect(getNotesState().notes).toHaveLength(2);
  });

  it('leaves an unreadable localStorage value alone', async () => {
    localStorage.setItem('notes', '{not json');
    await ensureLoaded();
    expect(localStorage.getItem('notes')).toBe('{not json');
    expect(getNotesState().notes).toEqual([]);
  });

  it('creates regular and task notes with timestamps', async () => {
    await ensureLoaded();
    const note = await createNote({ title: 'Plan', content: 'x' });
    const task = await createNote({ title: 'Today', kind: 'task' });
    expect(note).toMatchObject({ title: 'Plan', content: 'x' });
    expect(note.kind).toBeUndefined();
    expect(task.kind).toBe('task');
    expect(task.createdAt).toBe(task.updatedAt);
    expect((await rawRecords()).map((r) => r.id).sort()).toEqual([note.id, task.id].sort());
  });

  it('changes only the fields asked for, and keeps unknown fields', async () => {
    await seed([{ ...LEGACY[0], color: 'yellow' }]);
    await ensureLoaded();
    await updateNote(1, { pinned: true }, { touch: false });
    let [stored] = await rawRecords();
    expect(stored).toEqual({ ...LEGACY[0], color: 'yellow', pinned: true });
    await updateNote(1, { pinned: false }, { touch: false });
    [stored] = await rawRecords();
    expect(stored).toEqual({ ...LEGACY[0], color: 'yellow' });
    await updateNote(1, { title: 'Shopping' });
    [stored] = await rawRecords();
    expect(stored.title).toBe('Shopping');
    expect(stored.updatedAt).toBeGreaterThan(LEGACY[0].updatedAt);
  });

  it('applies a change here at once, before it is saved', async () => {
    await seed(LEGACY);
    await ensureLoaded();
    const saving = updateNote(2, { content: 'new' });
    expect(getNote(2).content).toBe('new');
    await saving;
    expect((await rawRecords()).find((r) => r.id === 2).content).toBe('new');
  });

  it('ticks a task on the stored text, keeping a change made elsewhere', async () => {
    await seed(LEGACY);
    await ensureLoaded();
    // Another tab pinned the note meanwhile (this tab hasn't heard yet).
    await seed([{ ...LEGACY[0], pinned: true }]);
    const ref = refOf(parseTasks(LEGACY[0].content)[0]);
    await updateContent(1, (c) => toggleChecked(c, ref));
    const stored = (await rawRecords()).find((r) => r.id === 1);
    expect(stored.content).toBe('- [x] milk\n- [x] eggs');
    expect(stored.pinned).toBe(true);
    expect(getNote(1).pinned).toBe(true);
  });

  it('saves an editor’s pending typing before a task change', async () => {
    await seed(LEGACY);
    await ensureLoaded();
    let pending = '- [ ] milk\n- [x] eggs\n- [ ] bread';
    const unregister = registerFlush(() => {
      if (pending) updateNote(1, { content: pending });
      pending = null;
    });
    await updateContent(1, (c) => toggleChecked(c, { index: 2, text: 'bread' }));
    expect(getNote(1).content).toBe('- [ ] milk\n- [x] eggs\n- [x] bread');
    expect((await rawRecords())[0].content).toBe('- [ ] milk\n- [x] eggs\n- [x] bread');
    unregister();
  });

  it('skips a task change whose task is gone', async () => {
    await seed(LEGACY);
    await ensureLoaded();
    const before = await rawRecords();
    await updateContent(1, (c) => toggleChecked(c, { index: 0, text: 'not there' }));
    expect(await rawRecords()).toEqual(before);
  });

  it('keeps an edit to a note deleted in another tab', async () => {
    await seed(LEGACY);
    await ensureLoaded();
    await seed([]); // no-op open
    await new Promise((resolve) => {
      const req = indexedDB.open('iweb-notes-db', 1);
      req.onsuccess = () => {
        const tx = req.result.transaction('notes', 'readwrite');
        tx.objectStore('notes').delete(2);
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
      };
    });
    await updateNote(2, { content: 'typed after the delete' });
    expect((await rawRecords()).find((r) => r.id === 2).content).toBe('typed after the delete');
  });

  it('deletes', async () => {
    await seed(LEGACY);
    await ensureLoaded();
    await deleteNote(1);
    expect(getNote(1)).toBe(null);
    expect((await rawRecords()).map((r) => r.id)).toEqual([2]);
  });

  it('normalizes damaged records for display only', () => {
    expect(normalizeNote(null)).toBe(null);
    expect(normalizeNote({ title: 'no id' })).toBe(null);
    const ok = { id: 3, title: 't', content: 'c', updatedAt: 1 };
    expect(normalizeNote(ok)).toBe(ok);
    expect(normalizeNote({ id: 4, content: 5 })).toEqual({ id: 4, title: '', content: '5', updatedAt: 0 });
  });
});
