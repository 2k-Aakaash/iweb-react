import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMacWindow } from '../libs/window/useMacWindow';
import { useWindows } from '../libs/window/windowRegistry';
import GlassSurface from './glass/GlassSurface';
import { applyFormat, markdownToText, toggleTask } from '../libs/notes/markdown';
import { canRedo, canUndo, createHistory, record, redo, undo, typingKind } from '../libs/notes/history';
import { createNote, deleteNote, getNote, registerFlush, updateContent, updateNote, useNotes } from '../libs/notes/notesStore';
import { progressLabel, refOf, taskProgress, toggleChecked } from '../libs/notes/tasks';
import { DATE_VIEWS, SORTS, VIEWS, filterView, listSections, searchNotes, taskKey, validView, viewCounts, viewLabel } from '../libs/notes/views';
import { useToday } from '../libs/notes/useToday';
import { STICKY_COLORS, pinToDesktop, removeFromDesktop, updateSticky, useStickies } from '../libs/notes/stickyStore';
import { findStickySpot } from '../libs/notes/stickyPlacement';
import { NOTES_OPEN_EVENT } from '../libs/notes/notesEvents';
import NotesSidebar from './notes/NotesSidebar';
import NoteList from './notes/NoteList';
import TaskChecklist, { ProgressBar } from './notes/TaskChecklist';
import PopupMenu from './notes/PopupMenu';
import { ComposeIcon, DesktopIcon, MoreIcon, NewTaskIcon, PinIcon, SearchIcon, SidebarIcon, SortIcon, TrashIcon } from './notes/notesIcons';
import '../styles/notes-sidebar.css';
import '../styles/notes-markdown.css';
import '../styles/notes-workspace.css';
import { showAlert, showConfirm } from '../libs/dialogs/dialogs';

// Notes: Markdown notes and Task Notes (daily to-dos) in one window, after macOS 26 Notes:
// views on the left (All Notes, Pinned, Today, Overdue, Upcoming, All Tasks, Completed,
// tags), the notes of the selected view in the middle, the note on the right (Write /
// Preview; a Task Note's Checklist / Write). Notes live in notesStore (shared with the
// desktop sticky cards); this window keeps a draft of the open note and saves it 0.8 s after
// typing stops, at once for checklist changes, and before anything else touches the note.
// The window loads on first open (App.jsx).

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

const SAVE_DELAY = 800;

// Preferences: the editor mode for notes (as before) and for Task Notes, and the window's
// view, sort, sidebar, hidden completed tasks and last note. Restored on open.
const MODE_KEY = 'iweb:notesMode';
const TASK_MODE_KEY = 'iweb:notesTaskMode';
const UI_KEY = 'iweb:notesUi';

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

const readModes = () => ({
  note: readStorage(MODE_KEY) === 'preview' ? 'preview' : 'write',
  task: readStorage(TASK_MODE_KEY) === 'write' ? 'write' : 'checklist',
});

function readUi() {
  let saved = {};
  try {
    saved = JSON.parse(readStorage(UI_KEY) || '{}') || {};
  } catch {
    /* damaged: defaults */
  }
  return {
    view: typeof saved.view === 'string' ? saved.view : 'all',
    sort: SORTS.some((s) => s.id === saved.sort) ? saved.sort : 'edited',
    sidebar: saved.sidebar !== false,
    hideDone: Boolean(saved.hideDone),
    noteId: saved.noteId ?? null,
  };
}

const EMPTY_DRAFT = { id: null, title: '', content: '', synced: { title: '', content: '' } };
const draftOf = (note) => ({ id: note.id, title: note.title, content: note.content, synced: { title: note.title, content: note.content } });
const isDirty = (d) => d.title !== d.synced.title || d.content !== d.synced.content;
const titleOf = (note) => note?.title?.trim() || 'Untitled Note';

const todayTitle = () => new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

export default function Notes({ open, setOpen, initialRequest = null }) {
  const overlayRef = useRef(null);
  const windowRef = useRef(null);
  const textareaRef = useRef(null);
  const titleRef = useRef(null);
  const searchRef = useRef(null);
  const editorRef = useRef(null);
  // macOS window: genies out of the Dock's Notes icon; red closes, yellow minimizes into the
  // icon, green zooms to full size.
  const menusRef = useRef(null); // menu-bar menus, set below once the handlers exist
  const win = useMacWindow({ app: 'notes', open, setOpen, windowRef, overlayRef, menus: menusRef });
  const mounted = win.mounted;
  const { front } = useWindows();

  const { status, notes } = useNotes();
  const stickies = useStickies();
  const { today, now } = useToday();
  const [ui, setUi] = useState(readUi);
  const [modes, setModes] = useState(readModes);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  // Undo / redo: one history per note, kept in memory while iWeb is open.
  const historiesRef = useRef(new Map());
  const [history, setHistory] = useState(null);
  const [saveError, setSaveError] = useState(false);
  const [menu, setMenu] = useState(null); // { anchor, items, label }
  const [renderMarkdown, setRenderMarkdown] = useState(null);
  const focusNextRef = useRef(null); // 'title' | 'add' | 'editor' after the next note loads

  // ---- What's shown --------------------------------------------------------------------
  const counts = useMemo(() => viewCounts(notes, today), [notes, today]);
  const view = status === 'ready' ? validView(ui.view, counts) : ui.view;
  const searching = query.trim().length > 0;
  // Tasks ticked in Today / Overdue / Upcoming stay there, done, until the view changes.
  const [kept, setKept] = useState({ view: null, keys: new Set(), ids: new Set() });
  const keep = kept.view === view && !searching ? kept : null;
  const listed = useMemo(
    () => (searching ? searchNotes(notes, query) : filterView(notes, view, today, keep?.ids)),
    [notes, view, today, query, searching, keep],
  );
  const sections = useMemo(() => listSections(listed, { sort: ui.sort, view: searching ? 'all' : view, now }), [listed, ui.sort, view, searching, now]);
  const ordered = useMemo(() => sections.flatMap((s) => s.notes), [sections]);
  const desktopIds = useMemo(() => new Set(Object.keys(stickies.cards)), [stickies]);

  const stored = draft.id !== null ? notes.find((n) => n.id === draft.id) || null : null;
  const isTask = stored?.kind === 'task';
  const dirty = isDirty(draft);
  const mode = isTask ? modes.task : modes.note;
  const onDesktop = stored ? desktopIds.has(String(stored.id)) : false;

  // ---- Keeping the draft and the store in step (during render, as React recommends for
  // state derived from changing inputs) ------------------------------------------------------
  const [seen, setSeen] = useState(null);
  if (status === 'ready' && draft.id === null && notes.length > 0) {
    // First load: the note open last time, else the first in the list.
    const first = notes.find((n) => n.id === ui.noteId) || ordered[0] || notes[0];
    setDraft(draftOf(first));
    setHistory(createHistory(first.content));
  } else if (status === 'ready' && draft.id !== null && !stored && !dirty) {
    // The open note was deleted (in another tab): show the next one.
    const next = ordered[0] || notes[0] || null;
    setDraft(next ? draftOf(next) : EMPTY_DRAFT);
    setHistory(next ? createHistory(next.content) : null);
  } else if (stored !== seen) {
    setSeen(stored);
    // Changed elsewhere (a sticky card, another tab): take the change unless there's
    // unsaved typing here, which wins and is saved shortly.
    if (stored && stored.id === draft.id && !dirty && (stored.content !== draft.synced.content || stored.title !== draft.synced.title)) {
      setDraft(draftOf(stored));
      if (stored.content !== draft.content) {
        const end = stored.content.length;
        setHistory((h) => record(h ?? createHistory(draft.content), { value: stored.content, start: end, end }, { kind: 'external' }));
      }
    }
  }

  // The latest draft for saves that run outside a render (a timer, closing, another view).
  const draftRef = useRef(draft);
  useLayoutEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const saveDraft = useCallback(() => {
    const d = draftRef.current;
    if (d.id === null || !isDirty(d)) return;
    const sent = { title: d.title, content: d.content };
    draftRef.current = { ...d, synced: sent };
    setDraft((cur) => (cur.id === d.id ? { ...cur, synced: sent } : cur));
    updateNote(d.id, sent).then(
      () => setSaveError(false),
      (err) => {
        console.error('Notes: could not save the note:', err);
        setSaveError(true);
      },
    );
  }, []);

  // Autosave after a pause in typing.
  useEffect(() => {
    if (!dirty || draft.id === null) return undefined;
    const timer = setTimeout(saveDraft, SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [draft, dirty, saveDraft]);

  // Save before anything else changes a note (a sticky card ticking a task), and when the
  // page is hidden or closed.
  useEffect(() => {
    const unregister = registerFlush(saveDraft);
    const onHide = () => document.visibilityState === 'hidden' && saveDraft();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', saveDraft);
    return () => {
      unregister();
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', saveDraft);
    };
  }, [saveDraft]);

  // Remember the view, sort, sidebar and open note; and the editor modes.
  useEffect(() => {
    writeStorage(UI_KEY, JSON.stringify({ view: ui.view, sort: ui.sort, sidebar: ui.sidebar, hideDone: ui.hideDone, noteId: draft.id }));
  }, [ui, draft.id]);
  useEffect(() => {
    writeStorage(MODE_KEY, modes.note);
    writeStorage(TASK_MODE_KEY, modes.task);
  }, [modes]);

  // Focus where a new note starts: its title, or a Task Note's "Add a task" field. While the
  // window genies in it can't take focus yet, so this tries again for up to a second.
  useEffect(() => {
    const target = focusNextRef.current;
    if (!target || !mounted) return undefined;
    focusNextRef.current = null;
    let frame = 0;
    let tries = 0;
    const attempt = () => {
      const el = target === 'title' ? titleRef.current
        : target === 'add' ? editorRef.current?.querySelector('.ntc-add input')
          : textareaRef.current;
      if (el) {
        el.focus({ preventScroll: true });
        if (target === 'title') el.select();
        if (document.activeElement === el) return;
      }
      if (++tries < 60) frame = requestAnimationFrame(attempt);
    };
    frame = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(frame);
  }, [draft.id, mounted, mode]);

  // The Preview renderer (marked + DOMPurify) loads the first time it's needed.
  const needsRenderer = (mode === 'preview' || mode === 'checklist') && draft.id !== null;
  useEffect(() => {
    if (!needsRenderer || renderMarkdown) return;
    import('../libs/notes/markdownRender').then((m) => setRenderMarkdown(() => m.renderMarkdown)).catch(() => {});
  }, [needsRenderer, renderMarkdown]);
  const previewHtml = useMemo(
    () => (mode === 'preview' && renderMarkdown ? renderMarkdown(draft.content) : ''),
    [mode, draft.content, renderMarkdown],
  );

  // ---- Actions -----------------------------------------------------------------------------
  const setMode = (next) => {
    setModes((m) => ({ ...m, [isTask ? 'task' : 'note']: next }));
  };

  const openNote = (note) => {
    if (!note) return;
    saveDraft();
    if (draft.id !== null && history) historiesRef.current.set(draft.id, history);
    const known = historiesRef.current.get(note.id);
    setDraft(draftOf(note));
    setHistory(known && known.present.value === note.content ? known : createHistory(note.content));
  };

  const selectNote = (id) => {
    if (id !== draft.id) openNote(getNote(id));
  };

  const newNote = async (kind = 'note') => {
    saveDraft();
    try {
      const note = kind === 'task'
        ? await createNote({ title: todayTitle(), kind: 'task' })
        : await createNote({ title: 'New Note' });
      setQuery('');
      // Show it: switch to a view it's in.
      setUi((u) => {
        if (kind === 'task') return u.view === 'all' || u.view === 'tasks' ? u : { ...u, view: 'tasks' };
        return u.view === 'all' ? u : { ...u, view: 'all' };
      });
      if (kind === 'task') setModes((m) => ({ ...m, task: 'checklist' }));
      else setModes((m) => ({ ...m, note: 'write' }));
      focusNextRef.current = kind === 'task' ? 'add' : 'title';
      openNote(note);
    } catch (err) {
      console.error('Notes: could not create a note:', err);
      showAlert({ title: 'The note couldn’t be created', message: 'Your browser may be out of storage space.' });
    }
  };

  const removeNote = async (note) => {
    const pinnedToDesktop = desktopIds.has(String(note.id));
    const ok = await showConfirm({
      title: `Delete “${titleOf(note)}”?`,
      message: `This can’t be undone.${pinnedToDesktop ? ' It will also be removed from your desktop.' : ''}`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const wasOpen = note.id === draft.id;
    const i = ordered.findIndex((n) => n.id === note.id);
    const next = ordered[i + 1] || ordered[i - 1] || null;
    if (wasOpen) {
      // Don't save what's being deleted.
      draftRef.current = { ...draftRef.current, synced: { title: draftRef.current.title, content: draftRef.current.content } };
    }
    try {
      await deleteNote(note.id);
    } catch (err) {
      console.error('Notes: could not delete the note:', err);
      showAlert({ title: 'The note couldn’t be deleted' });
      return;
    }
    removeFromDesktop(note.id);
    historiesRef.current.delete(note.id);
    if (wasOpen) {
      const fallback = next || null;
      setDraft(fallback ? draftOf(fallback) : EMPTY_DRAFT);
      setHistory(fallback ? createHistory(fallback.content) : null);
    }
  };

  const togglePin = (note) => updateNote(note.id, { pinned: !note.pinned }, { touch: false }).catch(() => setSaveError(true));

  const toggleDesktop = (note) => {
    if (desktopIds.has(String(note.id))) removeFromDesktop(note.id);
    else pinToDesktop(note.id, findStickySpot());
  };

  const convert = (note) => {
    const toTask = note.kind !== 'task';
    if (!toTask) removeFromDesktop(note.id);
    updateNote(note.id, { kind: toTask ? 'task' : null }, { touch: false }).catch(() => setSaveError(true));
  };

  const duplicate = async (note) => {
    saveDraft();
    const source = getNote(note.id) || note;
    try {
      const copy = await createNote({ title: `${titleOf(source)} copy`, content: source.content, kind: source.kind === 'task' ? 'task' : null });
      openNote(copy);
    } catch (err) {
      console.error('Notes: could not duplicate the note:', err);
    }
  };

  const noteMenu = (note) => {
    const task = note.kind === 'task';
    const desk = desktopIds.has(String(note.id));
    return [
      { label: note.pinned ? 'Unpin Note' : 'Pin Note', onSelect: () => togglePin(note) },
      task && { label: desk ? 'Remove from Desktop' : 'Show on Desktop', onSelect: () => toggleDesktop(note) },
      ...(desk ? [
        { type: 'header', label: 'Card Color' },
        { label: 'None (Glass)', checked: !stickies.cards[String(note.id)]?.color, onSelect: () => updateSticky(note.id, { color: null }) },
        ...STICKY_COLORS.map((c) => ({ label: c.label, swatch: c.swatch, checked: stickies.cards[String(note.id)]?.color === c.id, onSelect: () => updateSticky(note.id, { color: c.id }) })),
      ] : []),
      { type: 'separator' },
      { label: 'Rename', onSelect: () => {
        selectNote(note.id);
        focusNextRef.current = 'title';
        requestAnimationFrame(() => titleRef.current?.select());
      } },
      { label: 'Duplicate', onSelect: () => duplicate(note) },
      { label: task ? 'Convert to Regular Note' : 'Convert to Task Note', onSelect: () => convert(note) },
      { type: 'separator' },
      { label: 'Delete Note…', danger: true, onSelect: () => removeNote(note) },
    ];
  };

  // Every content change goes through here so it lands in the note's undo history.
  const changeContent = (value, { kind, start = value.length, end = start, before }) => {
    const base = history ?? createHistory(draft.content);
    setHistory(record(base, { value, start, end }, { kind, before }));
    setDraft((d) => ({ ...d, content: value }));
  };

  // A checklist change (a tick, a new task, a reorder) is saved at once, so a sticky card
  // and the list show it straight away.
  const changeTasks = (value, kind = 'task') => {
    if (value === draft.content || draft.id === null) return;
    changeContent(value, { kind });
    const sent = { title: draft.title, content: value };
    draftRef.current = { ...draftRef.current, content: value, synced: sent };
    setDraft((d) => ({ ...d, content: value, synced: sent }));
    updateNote(draft.id, sent).then(
      () => setSaveError(false),
      (err) => {
        console.error('Notes: could not save the note:', err);
        setSaveError(true);
      },
    );
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
    setHistory(h);
    setDraft((d) => ({ ...d, content: h.present.value }));
    if (mode === 'write') restoreSelection(h.present.start, h.present.end);
  };

  // Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z or Ctrl+Y redo. Returns true when handled.
  const handleUndoKeys = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
    if (e.target instanceof HTMLInputElement && e.target.type === 'text') return false; // the field's own undo
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
    const next = applyFormat(draft.content, before.start, before.end, name);
    changeContent(next.value, { kind: 'format', start: next.start, end: next.end, before });
    restoreSelection(next.start, next.end);
  };

  // Ticking a checklist box in the Preview updates the Markdown source.
  const handlePreviewClick = (e) => {
    const box = e.target.closest?.('input[data-task]');
    if (!box) return;
    e.preventDefault();
    changeTasks(toggleTask(draft.content, Number(box.dataset.task)));
  };

  const closeWindow = () => {
    saveDraft();
    setMenu(null);
    win.close();
  };

  // List rows: select, ⋯ / right-click menu, tick a task (Today, Overdue, Upcoming). The
  // list is memoized, so it gets one stable function that calls the latest handlers.
  const rowActionsRef = useRef(null);
  useLayoutEffect(() => {
    rowActionsRef.current = {
      select: (note) => selectNote(note.id),
      menu: (note, anchor) => setMenu({ anchor, items: noteMenu(note), label: titleOf(note) }),
      toggle: (note, task) => {
        if (DATE_VIEWS.includes(view)) {
          setKept((k) => {
            const base = k.view === view ? k : { keys: new Set(), ids: new Set() };
            return { view, keys: new Set(base.keys).add(taskKey(note, task)), ids: new Set(base.ids).add(note.id) };
          });
        }
        updateContent(note.id, (c) => toggleChecked(c, refOf(task))).catch(() => setSaveError(true));
      },
    };
  });
  const onRowAction = useCallback((action, note, extra) => rowActionsRef.current?.[action]?.(note, extra), []);

  // Opening on a note or a new note (a sticky card's Open in Notes; File → New in the menu
  // bar; { view } from Notification Center). The first request arrives with the window (App.jsx); later ones as events.
  const handleRequest = (detail) => {
    if (!detail) return;
    if (detail.create) {
      newNote(detail.create === 'task' ? 'task' : 'note');
      return;
    }
    // A view (Notification Center's Today widget, a tasks notification): show it.
    if (detail.view && !detail.noteId) {
      setQuery('');
      setUi((u) => ({ ...u, view: detail.view }));
      return;
    }
    const note = detail.noteId !== undefined && detail.noteId !== null ? getNote(detail.noteId) : null;
    if (!note) return;
    setQuery('');
    if (!filterView(notes, view, today).some((n) => n.id === note.id)) setUi((u) => ({ ...u, view: note.kind === 'task' ? 'tasks' : 'all' }));
    selectNote(note.id);
  };
  const requestRef = useRef(null);
  useLayoutEffect(() => {
    requestRef.current = handleRequest;
  });
  useEffect(() => {
    const onOpen = (e) => requestRef.current?.(e.detail);
    window.addEventListener(NOTES_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(NOTES_OPEN_EVENT, onOpen);
  }, []);
  const handledInitial = useRef(false);
  useEffect(() => {
    if (handledInitial.current || status !== 'ready') return;
    handledInitial.current = true;
    requestRef.current?.(initialRequest);
  }, [status, initialRequest]);

  // ---- Keyboard ----------------------------------------------------------------------------
  const keysRef = useRef(null);
  useLayoutEffect(() => {
    keysRef.current = (e) => {
      if (!open || (front && front.app !== 'notes')) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (e.key === 'Escape') {
        if (menu || document.querySelector('.nt-menu')) return; // the menu closes itself
        if (e.target === searchRef.current && query) {
          setQuery('');
          return;
        }
        closeWindow();
        return;
      }
      // Ctrl/Cmd + Shift + P: switch between Write and Preview (Checklist for Task Notes)
      if (mod && e.shiftKey && key === 'p' && draft.id !== null) {
        e.preventDefault();
        if (isTask) setMode(mode === 'checklist' ? 'write' : 'checklist');
        else setMode(mode === 'preview' ? 'write' : 'preview');
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && key === 's') {
        e.preventDefault();
        saveDraft();
        return;
      }
      // Ctrl + Alt + N: new Task Note (not AltGr + N, which types a letter on some keyboards)
      if (mod && e.altKey && key === 'n' && !e.getModifierState?.('AltGraph')) {
        e.preventDefault();
        newNote('task');
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && key === 'n') {
        e.preventDefault();
        newNote('note');
      }
    };
  });
  useEffect(() => {
    const onKey = (e) => keysRef.current?.(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Menu bar: File and View for Notes.
  useEffect(() => {
    menusRef.current = () => ({
      File: [
        { label: 'New Note', shortcut: 'Ctrl N', disabled: status !== 'ready', onSelect: () => newNote('note') },
        { label: 'New Task Note', shortcut: 'Ctrl Alt N', disabled: status !== 'ready', onSelect: () => newNote('task') },
        { type: 'separator' },
        { label: stored?.pinned ? 'Unpin Note' : 'Pin Note', disabled: !stored, onSelect: () => togglePin(stored) },
        { label: onDesktop ? 'Remove from Desktop' : 'Show on Desktop', disabled: !isTask, onSelect: () => toggleDesktop(stored) },
        { label: 'Duplicate Note', disabled: !stored, onSelect: () => duplicate(stored) },
        { label: isTask ? 'Convert to Regular Note' : 'Convert to Task Note', disabled: !stored, onSelect: () => convert(stored) },
        { type: 'separator' },
        { label: 'Delete Note…', disabled: !stored, onSelect: () => removeNote(stored) },
      ],
      View: [
        ...(isTask
          ? [
            { label: 'Checklist', checked: mode === 'checklist', disabled: !stored, onSelect: () => setMode('checklist') },
            { label: 'Write', shortcut: 'Ctrl Shift P', checked: mode === 'write', disabled: !stored, onSelect: () => setMode('write') },
          ]
          : [
            { label: 'Write', checked: mode === 'write', disabled: !stored, onSelect: () => setMode('write') },
            { label: 'Preview', shortcut: 'Ctrl Shift P', checked: mode === 'preview', disabled: !stored, onSelect: () => setMode('preview') },
          ]),
        { type: 'separator' },
        { label: ui.sidebar ? 'Hide Sidebar' : 'Show Sidebar', onSelect: () => setUi((u) => ({ ...u, sidebar: !u.sidebar })) },
        { label: 'Hide Completed Tasks', checked: ui.hideDone, onSelect: () => setUi((u) => ({ ...u, hideDone: !u.hideDone })) },
        { type: 'separator' },
        ...SORTS.map((s) => ({ label: `Sort by ${s.label}`, checked: ui.sort === s.id, onSelect: () => setUi((u) => ({ ...u, sort: s.id })) })),
      ],
    });
  });

  // ---- Render ------------------------------------------------------------------------------
  const words = useMemo(() => {
    const text = markdownToText(draft.content);
    return text ? text.split(/\s+/).length : 0;
  }, [draft.content]);
  const progress = useMemo(() => (isTask ? taskProgress(draft.content) : null), [isTask, draft.content]);

  const listTitle = searching ? 'Results' : viewLabel(view);
  const composeKind = DATE_VIEWS.includes(view) || view === 'tasks' || view === 'completed' ? 'task' : 'note';
  const modeTabs = isTask ? [['checklist', 'Checklist'], ['write', 'Write']] : [['write', 'Write'], ['preview', 'Preview']];
  let saveLabel = 'Saved';
  if (saveError) saveLabel = 'Save Failed';
  else if (dirty) saveLabel = 'Saving';

  let emptyList = searching ? `No results for “${query.trim()}”` : VIEWS[view]?.empty || 'No Notes';
  if (status === 'loading' || status === 'idle') emptyList = null; // a few ms: nothing, not a flash
  if (status === 'error') emptyList = 'Notes couldn’t be opened.';

  return (
    <>
      {mounted && (
        <div className="remove-bg-window" ref={overlayRef} style={{ display: 'block' }}>
          <div className={`remove-bg-content notes-overhaul-modal glass-host${win.maximized ? ' window-maximized' : ''}`} ref={windowRef}>
            <GlassSurface preset="window" />
            {/* macOS window dots */}
            <div className="window-controls">
              <span className="window-dot dot-close" role="button" aria-label="Close" onClick={closeWindow}></span>
              <span
                className="window-dot dot-minimize"
                role="button"
                aria-label="Minimize"
                onClick={() => {
                  saveDraft();
                  win.minimize();
                }}
              ></span>
              <span className="window-dot dot-maximize" role="button" aria-label={win.maximized ? 'Exit full size' : 'Zoom'} onClick={win.toggleMaximize}></span>
            </div>

            <div className={`notes-app-layout ntw${ui.sidebar ? '' : ' is-sidebar-hidden'}`}>
              {ui.sidebar && (
                <NotesSidebar
                  counts={counts}
                  view={searching ? null : view}
                  onView={(id) => {
                    setQuery('');
                    setUi((u) => ({ ...u, view: id }));
                    // Open the view's first note if the open one isn't in it.
                    const inView = filterView(notes, id, today);
                    if (!inView.some((n) => n.id === draft.id)) {
                      const first = listSections(inView, { sort: ui.sort, view: id, now }).flatMap((s) => s.notes)[0];
                      if (first) openNote(first);
                    }
                  }}
                  onNewNote={() => newNote('note')}
                  onNewTask={() => newNote('task')}
                  disabled={status !== 'ready'}
                />
              )}

              {/* The notes of the view */}
              <section className="notes-sidebar nsb ntl" aria-label={listTitle}>
                <div className="ntl-head">
                  <button
                    type="button"
                    className="nt-icon-btn"
                    title={ui.sidebar ? 'Hide Sidebar' : 'Show Sidebar'}
                    aria-label={ui.sidebar ? 'Hide sidebar' : 'Show sidebar'}
                    aria-pressed={ui.sidebar}
                    onClick={() => setUi((u) => ({ ...u, sidebar: !u.sidebar }))}
                  >
                    <SidebarIcon size={17} />
                  </button>
                  <div className="nsb-heading ntl-heading">
                    <h2>{listTitle}</h2>
                    <span className="nsb-count">
                      {listed.length} {listed.length === 1 ? 'note' : 'notes'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="nt-icon-btn"
                    title="Sort"
                    aria-label="Sort notes"
                    aria-haspopup="menu"
                    onClick={(e) => setMenu({
                      anchor: e.currentTarget,
                      label: 'Sort',
                      items: [{ type: 'header', label: 'Sort By' }, ...SORTS.map((s) => ({ label: s.label, checked: ui.sort === s.id, onSelect: () => setUi((u) => ({ ...u, sort: s.id })) }))],
                    })}
                  >
                    <SortIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className="nsb-compose"
                    title={composeKind === 'task' ? 'New Task Note (Ctrl+Alt+N)' : 'New Note (Ctrl+N)'}
                    aria-label={composeKind === 'task' ? 'New task note' : 'New note'}
                    disabled={status !== 'ready'}
                    onClick={() => newNote(composeKind)}
                  >
                    {composeKind === 'task' ? <NewTaskIcon size={17} /> : <ComposeIcon size={17} />}
                  </button>
                </div>

                <label className="nsb-search">
                  <SearchIcon size={14} />
                  <input
                    ref={searchRef}
                    type="text"
                    placeholder="Search all notes"
                    aria-label="Search all notes"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button type="button" className="nsb-search-clear" aria-label="Clear search" onClick={() => setQuery('')}>
                      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="currentColor" /><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#1c1c1e" strokeWidth="1.6" strokeLinecap="round" /></svg>
                    </button>
                  )}
                </label>

                <div className="nsb-list custom-scrollbar">
                  <NoteList
                    key={searching ? 'search' : view /* a new list starts at its first rows */}
                    sections={status === 'ready' ? sections : []}
                    activeId={draft.id}
                    view={searching ? 'all' : view}
                    today={today}
                    now={now}
                    desktopIds={desktopIds}
                    keep={keep?.keys}
                    onAction={onRowAction}
                    emptyText={emptyList}
                  />
                </div>
              </section>

              {/* The open note */}
              <main className="notes-editor-pane" ref={editorRef}>
                {draft.id === null || !stored ? (
                  <div className="notes-editor-empty">
                    {status === 'error' ? (
                      <p>Notes couldn’t open its storage. Your notes haven’t been changed; try reloading the page.</p>
                    ) : status !== 'ready' ? null : (
                      <>
                        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                        </svg>
                        <p>Write notes in Markdown, or plan your day with a Task Note.</p>
                        <div className="nt-empty-actions">
                          <button className="notes-new-btn-large" onClick={() => newNote('note')}>New Note</button>
                          <button className="notes-new-btn-large" onClick={() => newNote('task')}>New Task Note</button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className={`notes-editor-container${isTask ? ' is-task-note' : ''}`}>
                    <div className="notes-editor-header">
                      <div className="notes-editor-meta">
                        <span className={`notes-save-indicator${saveError ? ' is-error' : ''}`} role="status">
                          {saveLabel === 'Saving' ? <span className="saving-dots">Saving</span> : saveLabel}
                        </span>
                        {isTask && mode === 'checklist' ? null : isTask ? (
                          <span className="notes-word-count ntw-progress">
                            <ProgressBar done={progress.done} total={progress.total} className="is-small" />
                            {progressLabel(progress)}
                          </span>
                        ) : (
                          <span className="notes-word-count">
                            {words} words • {draft.content.length} chars
                          </span>
                        )}
                      </div>
                      <div className="notes-editor-actions">
                        <div className="notes-mode-switch" role="tablist" aria-label="Editor mode">
                          {modeTabs.map(([id, label]) => (
                            <button
                              key={id}
                              type="button"
                              role="tab"
                              aria-selected={mode === id}
                              className={mode === id ? 'is-active' : ''}
                              title={id === 'write' ? 'Edit Markdown (Ctrl+Shift+P)' : `${label} (Ctrl+Shift+P)`}
                              onClick={() => setMode(id)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          className={`nt-icon-btn${stored.pinned ? ' is-on' : ''}`}
                          title={stored.pinned ? 'Unpin Note' : 'Pin Note'}
                          aria-label={stored.pinned ? 'Unpin note' : 'Pin note'}
                          aria-pressed={Boolean(stored.pinned)}
                          onClick={() => togglePin(stored)}
                        >
                          <PinIcon size={16} filled={stored.pinned} />
                        </button>
                        {isTask && (
                          <button
                            type="button"
                            className={`nt-icon-btn${onDesktop ? ' is-on' : ''}`}
                            title={onDesktop ? 'Remove from Desktop' : 'Show on Desktop'}
                            aria-label={onDesktop ? 'Remove from desktop' : 'Show on desktop'}
                            aria-pressed={onDesktop}
                            onClick={() => toggleDesktop(stored)}
                          >
                            <DesktopIcon size={17} filled={onDesktop} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="nt-icon-btn"
                          title="More"
                          aria-label="More actions"
                          aria-haspopup="menu"
                          onClick={(e) => setMenu({ anchor: e.currentTarget, items: noteMenu(stored), label: titleOf(stored) })}
                        >
                          <MoreIcon size={16} />
                        </button>
                        <button
                          type="button"
                          className="nt-icon-btn is-danger"
                          title="Delete Note"
                          aria-label="Delete note"
                          onClick={() => removeNote(stored)}
                        >
                          <TrashIcon size={16} />
                        </button>
                      </div>
                    </div>

                    <input
                      ref={titleRef}
                      type="text"
                      className="notes-editor-title-input"
                      placeholder="Title"
                      aria-label="Title"
                      value={draft.title}
                      onChange={(e) => {
                        const value = e.target.value;
                        setDraft((d) => ({ ...d, title: value }));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (mode === 'write') textareaRef.current?.focus();
                          else editorRef.current?.querySelector('.ntc-add input, .notes-md-preview')?.focus();
                        }
                      }}
                    />

                    {mode === 'write' && (
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
                          aria-label="Note text (Markdown)"
                          placeholder={isTask
                            ? 'One task per line:\n\n- [ ] Review pull request !! 📅 2026-11-03\n- [x] Fix login issue'
                            : 'Start writing in Markdown…\n\n# Heading   **bold**   _italic_   - [ ] task   `code`'}
                          value={draft.content}
                          onChange={(e) => changeContent(e.target.value, {
                            kind: typingKind(draft.content, e.target.value),
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
                    )}
                    {mode === 'preview' && (
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
                    {mode === 'checklist' && (
                      <TaskChecklist
                        content={draft.content}
                        today={today}
                        onChange={changeTasks}
                        renderMarkdown={renderMarkdown}
                        hideDone={ui.hideDone}
                        onHideDoneChange={(hideDone) => setUi((u) => ({ ...u, hideDone }))}
                        onUndoKeys={handleUndoKeys}
                      />
                    )}
                  </div>
                )}
              </main>
            </div>
          </div>
        </div>
      )}
      {menu && <PopupMenu anchor={menu.anchor} items={menu.items} label={menu.label} onClose={() => setMenu(null)} />}
    </>
  );
}
