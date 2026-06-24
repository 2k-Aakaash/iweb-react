import React, { useState, useEffect, useRef } from 'react';

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
  const [searchQuery, setSearchQuery] = useState('');
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
  }, [showModal, db, activeNoteId, editorTitle, editorContent, notes]);

  // Format date helper
  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getWordCount = () => {
    const text = editorContent.trim();
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
      {showModal && (
        <div className="remove-bg-window" style={{ display: 'block' }}>
          <div className="remove-bg-content notes-overhaul-modal">
            {/* macOS window dots */}
            <div className="window-controls">
              <span
                className="window-dot dot-close"
                onClick={() => {
                  if (saveTimeoutRef.current) {
                    clearTimeout(saveTimeoutRef.current);
                    performSave();
                  }
                  setShowModal(false);
                }}
              ></span>
              <span className="window-dot dot-minimize"></span>
              <span className="window-dot dot-maximize"></span>
            </div>


            {/* Split Pane macOS Layout */}
            <div className="notes-app-layout">
              {/* Left Sidebar */}
              <aside className="notes-sidebar">
                <div className="notes-sidebar-header">
                  <h2>Notes</h2>
                  <button
                    className="notes-new-btn"
                    title="New Note (Ctrl+N)"
                    onClick={handleAddNewNote}
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                    </svg>
                  </button>
                </div>

                <div className="notes-search-wrapper">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  <input
                    type="text"
                    placeholder="Search notes..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <div className="notes-list custom-scrollbar">
                  {filteredNotes.length === 0 ? (
                    <div className="notes-empty-state">No Notes</div>
                  ) : (
                    filteredNotes.map((note) => {
                      const isActive = note.id === activeNoteId;
                      // Snippet: skip the title line
                      const lines = note.content.split('\n');
                      const snippet = lines.slice(1).join(' ').trim() || 'No additional text';
                      return (
                        <div
                          key={note.id}
                          className={`notes-list-item ${isActive ? 'active' : ''}`}
                          onClick={() => selectNote(note.id)}
                        >
                          <div className="notes-list-item-meta">
                            <span className="notes-list-item-title">{note.title || 'Untitled Note'}</span>
                            <button
                              className="notes-list-item-delete"
                              title="Delete note"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteNote(note.id);
                              }}
                            >
                              &times;
                            </button>
                          </div>
                          <p className="notes-list-item-snippet">{snippet}</p>
                          <span className="notes-list-item-date">{formatDate(note.updatedAt)}</span>
                        </div>
                      );
                    })
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

                    <textarea
                      className="notes-editor-textarea custom-scrollbar"
                      placeholder="Start writing here..."
                      value={editorContent}
                      onChange={(e) => handleEditorChange('content', e.target.value)}
                    />
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
