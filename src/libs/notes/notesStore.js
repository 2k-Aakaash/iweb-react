// The notes collection, shared by the Notes window and the desktop sticky cards, so a task
// ticked on a sticky is ticked in Notes at once (and the other way round).
//
// Storage is the same IndexedDB Notes has always used: 'iweb-notes-db', version 1, one
// 'notes' store keyed by an auto-increment id. Records are { id, title, content, updatedAt }
// and may now also carry createdAt, pinned and kind ('task' for a Task Note). Those fields
// are optional and only written when a note is created or changed, so notes from before
// keep their exact bytes; nothing is migrated and the database version stays 1 (backups
// open it at version 1 too).
//
// Every write is a read-modify-write in one transaction on the stored record, so a change
// only replaces the fields it's about (ticking a task never undoes a pin made in another
// tab). The change shows here at once and is confirmed when the transaction commits; other
// tabs hear about it on a BroadcastChannel and re-read that one note.
import { useSyncExternalStore } from 'react';

export const NOTES_DB = 'iweb-notes-db';
const STORE = 'notes';
const VERSION = 1;
const CHANNEL = 'iweb-notes';

let state = { status: 'idle', notes: [], error: null };
let dbPromise = null;
let loadPromise = null;
let channel = null;
const listeners = new Set();
const flushers = new Set();

function emit(patch) {
  state = { ...state, ...patch };
  for (const listener of [...listeners]) listener();
}

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(NOTES_DB, VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      };
      request.onsuccess = () => {
        const db = request.result;
        // Let a newer iWeb (another tab) upgrade the database; reopen on the next write.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
      request.onblocked = () => console.warn('Notes: the database is open in an older tab.');
    });
  }
  return dbPromise;
}

function run(mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result;
    fn(tx.objectStore(STORE), (value) => {
      result = value;
    });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  }));
}

/** A record as Notes uses it, or null when it isn't a note. Never written back. */
export function normalizeNote(raw) {
  if (!raw || typeof raw !== 'object' || raw.id === undefined || raw.id === null) return null;
  const ok = typeof raw.title === 'string' && typeof raw.content === 'string' && Number.isFinite(raw.updatedAt);
  if (ok) return raw; // same object: summaries are cached per record
  return {
    ...raw,
    title: typeof raw.title === 'string' ? raw.title : '',
    content: typeof raw.content === 'string' ? raw.content : String(raw.content ?? ''),
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
  };
}

// Notes from before IndexedDB: an array of strings in localStorage['notes']. Moved over
// once; the old key is only removed after every note was added.
async function migrateLegacy() {
  let stored;
  try {
    stored = localStorage.getItem('notes');
  } catch {
    return;
  }
  if (!stored) return;
  let old;
  try {
    old = JSON.parse(stored);
  } catch {
    return; // not ours, or damaged: leave it alone
  }
  if (!Array.isArray(old)) return;
  const texts = old.filter((t) => typeof t === 'string' && t.trim());
  await run('readwrite', (store) => {
    for (const text of texts) {
      const now = Date.now();
      store.add({ title: (text.split('\n')[0].substring(0, 30) || 'Untitled Note').trim(), content: text, updatedAt: now, createdAt: now });
    }
  });
  try {
    localStorage.removeItem('notes');
  } catch {
    /* blocked storage: it will be offered again, and skipped once the key is gone */
  }
}

function readAll() {
  return run('readonly', (store, done) => {
    const request = store.getAll();
    request.onsuccess = () => done(request.result || []);
  });
}

function readOne(id) {
  return run('readonly', (store, done) => {
    const request = store.get(id);
    request.onsuccess = () => done(normalizeNote(request.result));
  });
}

function broadcast(message) {
  try {
    channel?.postMessage(message);
  } catch {
    /* closed */
  }
}

function attachChannel() {
  if (channel || typeof BroadcastChannel === 'undefined') return;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = async ({ data }) => {
    if (!data || typeof data !== 'object') return;
    if (data.op === 'reload') {
      reloadNotes();
      return;
    }
    if (data.op === 'delete') {
      removeLocal(data.id);
      return;
    }
    if (data.op === 'put') {
      try {
        const note = await readOne(data.id);
        if (!note) removeLocal(data.id);
        else {
          const mine = getNote(data.id);
          if (!mine || note.updatedAt >= mine.updatedAt) putLocal(note);
        }
      } catch {
        /* the next change will try again */
      }
    }
  };
}

async function load() {
  emit({ status: 'loading', error: null });
  try {
    try {
      await migrateLegacy();
    } catch (err) {
      console.error('Notes: could not move notes from localStorage:', err);
    }
    const notes = (await readAll()).map(normalizeNote).filter(Boolean);
    attachChannel();
    emit({ status: 'ready', notes });
  } catch (err) {
    console.error('Notes: could not open the notes database:', err);
    emit({ status: 'error', error: err });
  }
}

/** Starts loading the notes (once); resolves when they're in. */
export function ensureLoaded() {
  if (!loadPromise) loadPromise = load();
  return loadPromise;
}

/** Re-reads every note (after a restore, or another tab replaced them). */
export function reloadNotes() {
  loadPromise = load();
  return loadPromise;
}

function subscribe(listener) {
  listeners.add(listener);
  ensureLoaded();
  return () => listeners.delete(listener);
}

const getSnapshot = () => state;

/** { status: 'idle' | 'loading' | 'ready' | 'error', notes, error } */
export function useNotes() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const getNotesState = () => state;
export const getNote = (id) => state.notes.find((n) => n.id === id) || null;

function putLocal(note) {
  const i = state.notes.findIndex((n) => n.id === note.id);
  if (i === -1) emit({ notes: [note, ...state.notes] });
  else if (state.notes[i] !== note) emit({ notes: state.notes.map((n, j) => (j === i ? note : n)) });
}

function removeLocal(id) {
  if (state.notes.some((n) => n.id === id)) emit({ notes: state.notes.filter((n) => n.id !== id) });
}

/** Creates a note and returns it (with its id). */
export async function createNote({ title = 'New Note', content = '', kind = null, pinned = false } = {}) {
  await ensureLoaded();
  const now = Date.now();
  const record = { title, content, updatedAt: now, createdAt: now };
  if (kind === 'task') record.kind = 'task';
  if (pinned) record.pinned = true;
  const id = await run('readwrite', (store, done) => {
    const request = store.add(record);
    request.onsuccess = () => done(request.result);
  });
  const note = { ...record, id };
  putLocal(note);
  broadcast({ op: 'put', id });
  return note;
}

/**
 * Changes a note. `change` is a patch, or a function of the note returning a patch (or null
 * for no change). It is applied to the note here at once, then to the stored record in one
 * transaction. `touch: false` keeps updatedAt (pinning isn't an edit). Resolves with the
 * stored note; rejects when it couldn't be saved (the change stays here, unsaved).
 */
export function updateNote(id, change, { touch = true } = {}) {
  const now = Date.now();
  const apply = (note) => {
    const patch = typeof change === 'function' ? change(note) : change;
    if (!patch) return null;
    const next = { ...note, ...patch };
    if (patch.kind === null) delete next.kind;
    if (patch.pinned === false) delete next.pinned;
    if (touch) next.updatedAt = now;
    return next;
  };
  const current = getNote(id);
  if (!current) return Promise.resolve(null);
  const optimistic = apply(current);
  if (!optimistic) return Promise.resolve(current);
  putLocal(optimistic);
  return run('readwrite', (store, done) => {
    const request = store.get(id);
    request.onsuccess = () => {
      const stored = normalizeNote(request.result);
      // Deleted in another tab while it was being edited here: keep the edit, not the loss.
      const next = stored ? apply(stored) || stored : optimistic;
      if (next !== stored) store.put(next);
      done(next);
    };
  }).then((saved) => {
    if (getNote(id) === optimistic) putLocal(saved);
    broadcast({ op: 'put', id });
    return saved;
  });
}

/**
 * Changes a note's Markdown with `fn(content) => content` (ticking a task, adding one…).
 * An editor with unsaved typing saves it first (registerFlush), so nothing is lost.
 */
export function updateContent(id, fn) {
  flushEdits();
  return updateNote(id, (note) => {
    const content = fn(note.content);
    return content === note.content ? null : { content };
  });
}

export async function deleteNote(id) {
  await run('readwrite', (store) => {
    store.delete(id);
  });
  removeLocal(id);
  broadcast({ op: 'delete', id });
}

/** Editors register a function that saves pending typing right away. */
export function registerFlush(fn) {
  flushers.add(fn);
  return () => flushers.delete(fn);
}

export function flushEdits() {
  for (const fn of [...flushers]) fn();
}

/** Tells every tab to re-read its notes (a backup was restored into the database). */
export function announceReload() {
  if (typeof BroadcastChannel === 'undefined') return;
  const ch = new BroadcastChannel(CHANNEL);
  ch.postMessage({ op: 'reload' });
  ch.close();
}

/** For tests. */
export function _resetNotesStore() {
  channel?.close();
  channel = null;
  dbPromise?.then((db) => db.close()).catch(() => {});
  dbPromise = null;
  loadPromise = null;
  flushers.clear();
  listeners.clear();
  state = { status: 'idle', notes: [], error: null };
}
