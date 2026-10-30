import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useMacWindow } from '../libs/window/useMacWindow';
import GlassSurface from './glass/GlassSurface';
import { applyFormat, markdownToText, renderMarkdown, toggleTask } from '../libs/notes/markdown';
import { canRedo, canUndo, createHistory, record, redo, undo, typingKind } from '../libs/notes/history';
import { groupNotes, rowDate } from '../libs/notes/groups';
import '../styles/notes-sidebar.css';
import '../styles/notes-markdown.css';

// Formatting toolbar (Write mode): [format, label, title]; null is a separator.
const TOOLBAR = [
  ['heading', 'H', 'Heading'],
  ['bold', 'B', 'Bold (Ctrl+B)'],
  ['italic', 'I', 'Italic (Ctrl+I)'],
  ['strike', 'S', 'Strikethrough'],
  null,
  ['bullet', '•', 'Bulleted list'],
  ['number', '1.', 'Numbered list'],
  ['task', '☐', 'Checklist'],
  ['quote', '❝', 'Quote'],
  null,
  ['code', '</>', 'Inline code'],
  ['codeblock', '{ }', 'Code block'],
  ['link', '🔗', 'Link'],
];

const MODE_KEY = 'iweb:notesMode';
const readMode = () => {
  try {
    return localStorage.getItem(MODE_KEY) === 'preview' ? 'preview' : 'write';
  } catch {
    return 'write';
  }
};

const DB_NAME = 'iweb-notes-db';
const STORE_NAME = 'notes';

// Promise-based IndexedDB Helpers
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = (e) => {
      resolve(e.target.result);
    };
    request.onerror = (e) => {
      reject(e.target.error);
    };
  });
}

function getAllNotesFromDB(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function addNoteToDB(db, note) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(note);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function updateNoteInDB(db, note) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(note);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteNoteFromDB(db, id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export default function Notes() {
  const [db, setDb] = useState(null);
  const [notes, setNotes] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const overlayRef = useRef(null);
  const windowRef = useRef(null);
  // macOS window: genies out of the Dock's Notes icon; red closes, yellow minimizes into the
  // icon, green zooms to full size.
  const menusRef = useRef(null); // menu-bar menus, set below once the handlers exist
  const win = useMacWindow({ app: 'notes', open: showModal, setOpen: setShowModal, windowRef, overlayRef, menus: menusRef });
  const mounted = win.mounted;
  const [searchQuery, setSearchQuery] = useState('');
  // Markdown: write the source, or preview it rendered. Remembered between sessions.
  const [mode, setModeState] = useState(readMode);
  const setMode = (next) => {
    setModeState(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* private mode */
    }
  };
  const textareaRef = useRef(null);
  // Undo / redo: one history per note, kept in memory while iWeb is open.
  const historiesRef = useRef(new Map());
  const [history, setHistory] = useState(null);
  const [activeNoteId, setActiveNoteId] = useState(null);

  // Open modal via custom event
  useEffect(() => {
    const handleOpen = () => {
      setShowModal(true);
    };
    window.addEventListener('notes:open', handleOpen);
    return () => {
      window.removeEventListener('notes:open', handleOpen);
    };
  }, []);

  // Local state for the currently active note in the editor (to avoid laggy typing)
  const [editorTitle, setEditorTitle] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [saveStatus, setSaveStatus] = useState('Saved'); // 'Saved', 'Saving...', 'Error'

  const saveTimeoutRef = useRef(null);

  // Initialize DB and migrate from localStorage if present
  useEffect(() => {
    initDB()
      .then(async (database) => {
        setDb(database);
        let loadedNotes = await getAllNotesFromDB(database);

        // Check for migration from localStorage
        const stored = localStorage.getItem('notes');
        if (stored) {
          try {
            const oldNotes = JSON.parse(stored);
            if (Array.isArray(oldNotes) && oldNotes.length > 0) {
              for (const oldNoteText of oldNotes) {
                if (typeof oldNoteText === 'string' && oldNoteText.trim() !== '') {
                  const title = oldNoteText.split('\n')[0].substring(0, 30) || 'Untitled Note';
                  const newNote = {
                    title: title.trim(),
                    content: oldNoteText,
                    updatedAt: Date.now(),
                  };
                  await addNoteToDB(database, newNote);
                }
              }
              // Reload notes after migration
              loadedNotes = await getAllNotesFromDB(database);
            }
          } catch (err) {
            console.error('Error migrating localStorage notes:', err);
          } finally {
            localStorage.removeItem('notes');
          }
        }

        // Sort by update date descending
        loadedNotes.sort((a, b) => b.updatedAt - a.updatedAt);
        setNotes(loadedNotes);

        if (loadedNotes.length > 0) {
          setActiveNoteId(loadedNotes[0].id);
        }
      })
      .catch((err) => console.error('Failed to initialize notes DB:', err));
  }, []);

  // Sync editor fields when activeNoteId changes
  useEffect(() => {
    if (activeNoteId !== null) {
      const activeNote = notes.find((n) => n.id === activeNoteId);
      if (activeNote) {
        setEditorTitle(activeNote.title);
        setEditorContent(activeNote.content);
        const known = historiesRef.current.get(activeNote.id);
        const h = known && known.present.value === activeNote.content ? known : createHistory(activeNote.content);
        historiesRef.current.set(activeNote.id, h);
        setHistory(h);
        setSaveStatus('Saved');
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
      }
    } else {
      setEditorTitle('');
      setEditorContent('');
    }
  }, [activeNoteId, notes]);

  // Handle note selection
  const selectNote = (id) => {
    // If there is a pending save, execute it immediately
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      performSave();
    }
    setActiveNoteId(id);
  };

  // Trigger auto-save on title or content change
  const handleEditorChange = (field, value) => {
    if (field === 'title') {
      setEditorTitle(value);
    } else {
      setEditorContent(value);
    }
    setSaveStatus('Saving...');

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce save
    saveTimeoutRef.current = setTimeout(() => {
      performSave(field === 'title' ? value : editorTitle, field === 'content' ? value : editorContent);
    }, 800);
  };

  const performSave = (titleToSave = editorTitle, contentToSave = editorContent) => {
    if (!db || activeNoteId === null) return;

    const activeNote = notes.find((n) => n.id === activeNoteId);
    if (!activeNote) return;

    // Avoid saving if no changes made
    if (activeNote.title === titleToSave && activeNote.content === contentToSave) {
      setSaveStatus('Saved');
      return;
    }

    const updatedNote = {
      ...activeNote,
      title: titleToSave || 'Untitled Note',
      content: contentToSave,
      updatedAt: Date.now(),
    };

    updateNoteInDB(db, updatedNote)
      .then(() => {
        setSaveStatus('Saved');
        // Update notes state and re-sort
        setNotes((prevNotes) => {
          const updatedList = prevNotes.map((n) => (n.id === activeNoteId ? updatedNote : n));
          return updatedList.sort((a, b) => b.updatedAt - a.updatedAt);
        });
      })
      .catch((err) => {
        console.error('Error autosaving note:', err);
        setSaveStatus('Error');
      });
  };

  // Add a new note
  const handleAddNewNote = async () => {
    if (!db) return;

    const newNote = {
      title: 'New Note',
      content: '',
      updatedAt: Date.now(),
    };

    try {
      const newId = await addNoteToDB(db, newNote);
      const createdNote = { ...newNote, id: newId };
      setNotes((prevNotes) => [createdNote, ...prevNotes]);
      setActiveNoteId(newId);
      setSaveStatus('Saved');
    } catch (err) {
      console.error('Error creating note:', err);
    }
  };

  // Delete current or specific note
  const handleDeleteNote = async (idToDelete) => {
    if (!db) return;
    const targetId = idToDelete || activeNoteId;
    if (targetId === null) return;

    const confirmDelete = window.confirm(
      'Are you sure you want to delete this note? This action cannot be undone.'
    );

    if (confirmDelete) {
      try {
        await deleteNoteFromDB(db, targetId);
        const updatedNotes = notes.filter((n) => n.id !== targetId);
        setNotes(updatedNotes);

        if (targetId === activeNoteId) {
          if (updatedNotes.length > 0) {
            setActiveNoteId(updatedNotes[0].id);
          } else {
            setActiveNoteId(null);
          }
        }
      } catch (err) {
        console.error('Error deleting note:', err);
      }
    }
  };

  // Save a pending edit right away (before the window closes or minimizes).
  const flushSave = () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      performSave();
    }
  };

  // Global escape and key bindings
  useEffect(() => {
    const handleGlobalKeys = (e) => {
      if (e.key === 'Escape' && showModal) {
        // Save immediately before closing
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          performSave();
        }
        setShowModal(false);
      }
      // Ctrl/Cmd + Shift + P: switch between Write and Preview
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p' && showModal && activeNoteId !== null) {
        e.preventDefault();
        setMode(mode === 'preview' ? 'write' : 'preview');
        return;
      }
      // Ctrl + S (manual save trigger)
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && showModal) {
        e.preventDefault();
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        performSave();
      }
      // Ctrl + N (new note)
      if ((e.ctrlKey || e.metaKey) && e.key === 'n' && showModal) {
        e.preventDefault();
        handleAddNewNote();
      }
    };
    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [showModal, db, activeNoteId, editorTitle, editorContent, notes, mode]);

  // Every content change goes through here so it lands in the note's undo history.
  const changeContent = (value, { kind, start = value.length, end = start, before }) => {
    const base = history ?? createHistory(editorContent);
    const h = record(base, { value, start, end }, { kind, before });
    historiesRef.current.set(activeNoteId, h);
    setHistory(h);
    handleEditorChange('content', value);
  };

  // Put the textarea's caret / selection back after a programmatic change.
  const restoreSelection = (start, end) => {
    const el = textareaRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start, end);
    });
  };

  const stepHistory = (direction) => {
    if (!history) return;
    const can = direction === 'undo' ? canUndo(history) : canRedo(history);
    if (!can) return;
    const h = direction === 'undo' ? undo(history) : redo(history);
    historiesRef.current.set(activeNoteId, h);
    setHistory(h);
    handleEditorChange('content', h.present.value);
    if (mode === 'write') restoreSelection(h.present.start, h.present.end);
  };

  // Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z or Ctrl+Y redo. Returns true when handled.
  const handleUndoKeys = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      stepHistory('undo');
      return true;
    }
    if ((key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey)) {
      e.preventDefault();
      stepHistory('redo');
      return true;
    }
    return false;
  };

  // Apply a toolbar format to the textarea's selection, keeping focus and selecting the result.
  const format = (name) => {
    const el = textareaRef.current;
    if (!el) return;
    const before = { start: el.selectionStart, end: el.selectionEnd };
    const next = applyFormat(editorContent, before.start, before.end, name);
    changeContent(next.value, { kind: 'format', start: next.start, end: next.end, before });
    restoreSelection(next.start, next.end);
  };

  // Ticking a checklist box in the Preview updates the Markdown source.
  // Menu bar: File → New / Delete Note, View → Write / Preview.
  useEffect(() => {
    menusRef.current = () => ({
      File: [
        { label: 'New Note', disabled: !db, onSelect: handleAddNewNote },
        { label: 'Delete Note…', disabled: activeNoteId === null, onSelect: () => handleDeleteNote() },
      ],
      View: [
        { label: 'Write', checked: mode === 'write', disabled: activeNoteId === null, onSelect: () => setMode('write') },
        { label: 'Preview', shortcut: 'Ctrl Shift P', checked: mode === 'preview', disabled: activeNoteId === null, onSelect: () => setMode('preview') },
      ],
    });
  });

  const handlePreviewClick = (e) => {
    const box = e.target.closest?.('input[data-task]');
    if (!box) return;
    e.preventDefault();
    changeContent(toggleTask(editorContent, Number(box.dataset.task)), { kind: 'task' });
  };

  const previewHtml = useMemo(
    () => (mode === 'preview' ? renderMarkdown(editorContent) : ''),
    [mode, editorContent],
  );

  const getWordCount = () => {
    const text = markdownToText(editorContent);
    return text ? text.split(/\s+/).length : 0;
  };

  const getCharCount = () => {
    return editorContent.length;
  };

  // Filter notes based on search query
  const filteredNotes = notes.filter(
    (n) =>
      n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <>
      {mounted && (
        <div className="remove-bg-window" ref={overlayRef} style={{ display: 'block' }}>
          <div className={`remove-bg-content notes-overhaul-modal glass-host${win.maximized ? ' window-maximized' : ''}`} ref={windowRef}>
            <GlassSurface preset="window" />
            {/* macOS window dots */}
            <div className="window-controls">
              <span
                className="window-dot dot-close"
                role="button"
                aria-label="Close"
                onClick={() => {
                  flushSave();
                  win.close();
                }}
              ></span>
              <span
                className="window-dot dot-minimize"
                role="button"
                aria-label="Minimize"
                onClick={() => {
                  flushSave();
                  win.minimize();
                }}
              ></span>
              <span
                className="window-dot dot-maximize"
                role="button"
                aria-label={win.maximized ? 'Exit full size' : 'Zoom'}
                onClick={win.toggleMaximize}
              ></span>
            </div>


            {/* Split Pane macOS Layout */}
            <div className="notes-app-layout">
              {/* Left Sidebar */}
              <aside className="notes-sidebar nsb">
                {/* macOS 26 Notes: large title + count, compose button, search, dated sections. */}
                <div className="nsb-header">
                  <div className="nsb-heading">
                    <h2>Notes</h2>
                    <span className="nsb-count">
                      {notes.length} {notes.length === 1 ? 'note' : 'notes'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="nsb-compose"
                    title="New Note (Ctrl+N)"
                    aria-label="New note"
                    onClick={handleAddNewNote}
                  >
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
                      <path d="M17.6 3.4a2 2 0 0 1 2.9 2.9L12 14.8l-3.6.8.8-3.6z" />
                    </svg>
                  </button>
                </div>

                <label className="nsb-search">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" />
                    <line x1="20.5" y1="20.5" x2="16" y2="16" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search"
                    aria-label="Search notes"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button type="button" className="nsb-search-clear" aria-label="Clear search" onClick={() => setSearchQuery('')}>
                      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="currentColor" /><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#1c1c1e" strokeWidth="1.6" strokeLinecap="round" /></svg>
                    </button>
                  )}
                </label>

                <div className="nsb-list custom-scrollbar">
                  {filteredNotes.length === 0 ? (
                    <div className="nsb-empty">
                      {searchQuery ? `No results for “${searchQuery}”` : 'No Notes'}
                    </div>
                  ) : (
                    groupNotes(filteredNotes).map((group) => (
                      <section key={group.label} className="nsb-group" aria-label={group.label}>
                        <h3 className="nsb-group-title">{group.label}</h3>
                        <ul className="nsb-rows">
                          {group.notes.map((note) => {
                            const isActive = note.id === activeNoteId;
                            const snippet = markdownToText(note.content) || 'No additional text';
                            return (
                              <li key={note.id} className={`nsb-row${isActive ? ' is-active' : ''}`}>
                                <button
                                  type="button"
                                  className="nsb-row-main"
                                  aria-current={isActive ? 'true' : undefined}
                                  onClick={() => selectNote(note.id)}
                                >
                                  <span className="nsb-row-title">{note.title || 'Untitled Note'}</span>
                                  <span className="nsb-row-sub">
                                    <span className="nsb-row-date">{rowDate(note.updatedAt)}</span>
                                    <span className="nsb-row-snippet">{snippet}</span>
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  className="nsb-row-delete"
                                  title="Delete note"
                                  aria-label={`Delete ${note.title || 'note'}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteNote(note.id);
                                  }}
                                >
                                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
                                  </svg>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    ))
                  )}
                </div>
              </aside>

              {/* Right Editor Pane */}
              <main className="notes-editor-pane">
                {activeNoteId === null ? (
                  <div className="notes-editor-empty">
                    <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                    <p>Select a note or create a new one to start writing.</p>
                    <button className="notes-new-btn-large" onClick={handleAddNewNote}>
                      Create New Note
                    </button>
                  </div>
                ) : (
                  <div className="notes-editor-container">
                    <div className="notes-editor-header">
                      <div className="notes-editor-meta">
                        <span className="notes-save-indicator">
                          {saveStatus === 'Saving...' && (
                            <span className="saving-dots">Saving</span>
                          )}
                          {saveStatus === 'Saved' && 'Saved'}
                          {saveStatus === 'Error' && 'Save Failed'}
                        </span>
                        <span className="notes-word-count">
                          {getWordCount()} words • {getCharCount()} chars
                        </span>
                      </div>
                      <div className="notes-editor-actions">
                        <div className="notes-mode-switch" role="tablist" aria-label="Editor mode">
                          {[['write', 'Write'], ['preview', 'Preview']].map(([id, label]) => (
                            <button
                              key={id}
                              type="button"
                              role="tab"
                              aria-selected={mode === id}
                              className={mode === id ? 'is-active' : ''}
                              title={id === 'preview' ? 'Preview Markdown (Ctrl+Shift+P)' : 'Edit Markdown (Ctrl+Shift+P)'}
                              onClick={() => setMode(id)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <button
                          className="notes-action-btn notes-delete-btn"
                          title="Delete Note"
                          onClick={() => handleDeleteNote(activeNoteId)}
                        >
                          Delete Note
                        </button>
                      </div>
                    </div>

                    <input
                      type="text"
                      className="notes-editor-title-input"
                      placeholder="Title"
                      value={editorTitle}
                      onChange={(e) => handleEditorChange('title', e.target.value)}
                    />

                    {mode === 'write' ? (
                      <>
                        <div className="notes-md-toolbar" role="toolbar" aria-label="Markdown formatting">
                          <button
                            type="button"
                            className="notes-md-btn notes-md-history"
                            title="Undo (Ctrl+Z)"
                            aria-label="Undo"
                            disabled={!history || !canUndo(history)}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => stepHistory('undo')}
                          >
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
                          </button>
                          <button
                            type="button"
                            className="notes-md-btn notes-md-history"
                            title="Redo (Ctrl+Shift+Z)"
                            aria-label="Redo"
                            disabled={!history || !canRedo(history)}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => stepHistory('redo')}
                          >
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
                          </button>
                          <span className="notes-md-sep" aria-hidden="true" />
                          {TOOLBAR.map((item, i) => (item ? (
                            <button
                              key={item[0]}
                              type="button"
                              className={`notes-md-btn notes-md-${item[0]}`}
                              title={item[2]}
                              aria-label={item[2]}
                              onMouseDown={(e) => e.preventDefault() /* keep the textarea selection */}
                              onClick={() => format(item[0])}
                            >
                              {item[1]}
                            </button>
                          ) : <span key={`sep-${i}`} className="notes-md-sep" aria-hidden="true" />))}
                          <span className="notes-md-hint">Markdown</span>
                        </div>
                        <textarea
                          ref={textareaRef}
                          className="notes-editor-textarea custom-scrollbar"
                          placeholder={'Start writing in Markdown…\n\n# Heading   **bold**   _italic_   - [ ] task   `code`'}
                          value={editorContent}
                          onChange={(e) => changeContent(e.target.value, {
                            kind: typingKind(editorContent, e.target.value),
                            start: e.target.selectionStart,
                            end: e.target.selectionEnd,
                          })}
                          onKeyDown={(e) => {
                            if (handleUndoKeys(e)) return;
                            if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
                            const key = e.key.toLowerCase();
                            if (key === 'b' || key === 'i') {
                              e.preventDefault();
                              format(key === 'b' ? 'bold' : 'italic');
                            }
                          }}
                        />
                      </>
                    ) : (
                      <div
                        className="notes-md-preview custom-scrollbar"
                        tabIndex={0}
                        onKeyDown={handleUndoKeys /* undo / redo after ticking checklists */}
                        onClick={(e) => {
                          e.currentTarget.focus({ preventScroll: true });
                          handlePreviewClick(e);
                        }}
                        // renderMarkdown() sanitizes the HTML with DOMPurify.
                        dangerouslySetInnerHTML={{ __html: previewHtml || '<p class="notes-md-empty">Nothing to preview yet.</p>' }}
                      />
                    )}
                  </div>
                )}
              </main>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
