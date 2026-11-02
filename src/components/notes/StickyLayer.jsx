import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { resolvePosition } from '../../libs/desktop/layout';
import { updateContent, useNotes } from '../../libs/notes/notesStore';
import { openNotes } from '../../libs/notes/notesEvents';
import { STICKY_W, landSticky } from '../../libs/notes/stickyPlacement';
import { STICKY_COLORS, pruneStickies, raiseSticky, removeFromDesktop, updateSticky, useStickies } from '../../libs/notes/stickyStore';
import { addTask, parseTasks, progressLabel, refOf, toggleChecked } from '../../libs/notes/tasks';
import { useToday } from '../../libs/notes/useToday';
import PopupMenu from './PopupMenu';
import { DueChip, PriorityMarks, ProgressBar } from './TaskChecklist';
import { ChevronIcon, CloseIcon, MoreIcon, PlusIcon } from './notesIcons';
import '../../styles/notes-sticky.css';

// Task Notes on the desktop: compact sticky cards over the wallpaper and widgets, under app
// windows. A card is a live view of its note (notesStore): ticking or adding a task here
// changes the note's Markdown, and an edit in Notes shows here at once. Drag a card by its
// title bar (or focus the title and use the arrow keys); the spot is kept relative to the
// nearest screen edge (stickyStore) and the card is kept on screen. Closing a card only takes
// it off the desktop. Loaded by App.jsx only while at least one card is on the desktop.

const titleOf = (note) => note.title.trim() || 'Untitled Note';
const KEY_STEP = 16;

function StickyNote({ note, card, today, viewport }) {
  const ref = useRef(null);
  const addRef = useRef(null);
  const [size, setSize] = useState({ w: STICKY_W, h: 180 });
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState(null);
  const tasks = useMemo(() => parseTasks(note.content), [note.content]);
  const done = tasks.filter((t) => t.checked).length;
  const visible = card.hideDone ? tasks.filter((t) => !t.checked) : tasks;
  const title = titleOf(note);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(() => {
      setSize((prev) => (prev.w === el.offsetWidth && prev.h === el.offsetHeight ? prev : { w: el.offsetWidth, h: el.offsetHeight }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Kept on screen whatever the window size (the saved anchors don't change).
  const pos = resolvePosition(card, size.w, size.h, viewport.w, viewport.h);

  const moveTo = (rect) => updateSticky(note.id, landSticky(rect));

  const onPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest('button, input, a, label, [role="menu"]')) return;
    e.preventDefault();
    const el = ref.current;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, rect: el.getBoundingClientRect() };
    let frame = 0;
    let dx = 0;
    let dy = 0;
    setDragging(true);
    const move = (ev) => {
      dx = ev.clientX - start.x;
      dy = ev.clientY - start.y;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.transform = `translate(${dx}px, ${dy}px)`;
      });
    };
    const end = () => {
      cancelAnimationFrame(frame);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      el.style.transform = '';
      setDragging(false);
      if (Math.hypot(dx, dy) > 3) moveTo({ left: start.rect.left + dx, top: start.rect.top + dy, w: start.rect.width, h: start.rect.height });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };

  const onHandleKey = (e) => {
    const step = e.shiftKey ? KEY_STEP * 4 : KEY_STEP;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      const r = ref.current.getBoundingClientRect();
      moveTo({ left: r.left + moves[e.key][0], top: r.top + moves[e.key][1], w: r.width, h: r.height });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openNotes({ noteId: note.id });
    }
  };

  const toggle = (task) => {
    updateContent(note.id, (c) => toggleChecked(c, refOf(task))).catch((err) => console.error('Notes: could not save the task:', err));
  };

  const add = (e) => {
    e.preventDefault();
    const value = addRef.current.value.trim();
    if (!value) return;
    addRef.current.value = '';
    updateContent(note.id, (c) => addTask(c, value)).catch((err) => console.error('Notes: could not add the task:', err));
  };

  const menuItems = [
    { label: 'Open in Notes', onSelect: () => openNotes({ noteId: note.id }) },
    { type: 'separator' },
    { label: card.expanded ? 'Compact Card' : 'Expand Card', onSelect: () => updateSticky(note.id, { expanded: !card.expanded }) },
    { label: 'Hide Completed Tasks', checked: card.hideDone, onSelect: () => updateSticky(note.id, { hideDone: !card.hideDone }) },
    { type: 'separator' },
    { type: 'header', label: 'Color' },
    { label: 'None (Glass)', checked: !card.color, onSelect: () => updateSticky(note.id, { color: null }) },
    ...STICKY_COLORS.map((c) => ({ label: c.label, swatch: c.swatch, checked: card.color === c.id, onSelect: () => updateSticky(note.id, { color: c.id }) })),
    { type: 'separator' },
    { label: 'Remove from Desktop', onSelect: () => removeFromDesktop(note.id) },
  ];

  return (
    <section
      ref={ref}
      data-color={card.color || undefined}
      className={`stk-card${card.expanded ? ' is-expanded' : ''}${dragging ? ' is-dragging' : ''}`}
      data-sticky-note={note.id}
      aria-label={`${title}, task note on the desktop`}
      style={{ left: pos.left, top: pos.top, zIndex: 1010 + card.z }}
      onPointerDownCapture={() => raiseSticky(note.id)}
      onContextMenu={(e) => {
        if (e.target.closest('input')) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <header className="stk-head" onPointerDown={onPointerDown} onDoubleClick={(e) => !e.target.closest('button') && openNotes({ noteId: note.id })}>
        <div
          className="stk-title"
          tabIndex={0}
          role="button"
          aria-roledescription="movable card"
          aria-label={`${title}. Arrow keys move the card; Enter opens it in Notes.`}
          title="Drag to move · double-click to open in Notes"
          onKeyDown={onHandleKey}
        >
          <span className="stk-title-text">{title}</span>
          <span className="stk-count">{tasks.length ? `${done}/${tasks.length}` : ''}</span>
        </div>
        <button
          type="button"
          className="stk-btn"
          title={card.expanded ? 'Compact' : 'Expand'}
          aria-label={card.expanded ? 'Compact card' : 'Expand card'}
          aria-expanded={card.expanded}
          onClick={() => updateSticky(note.id, { expanded: !card.expanded })}
        >
          <ChevronIcon size={13} up={card.expanded} />
        </button>
        <button
          type="button"
          className="stk-btn"
          title="Options"
          aria-label={`Options for ${title}`}
          aria-haspopup="menu"
          onClick={(e) => setMenu(menu ? null : e.currentTarget)}
        >
          <MoreIcon size={13} />
        </button>
        <button type="button" className="stk-btn" title="Remove from Desktop" aria-label={`Remove ${title} from the desktop`} onClick={() => removeFromDesktop(note.id)}>
          <CloseIcon size={11} />
        </button>
      </header>

      <div className="stk-progress-row">
        <ProgressBar done={done} total={tasks.length} className="stk-progress" />
        <span className="stk-progress-label">{progressLabel({ done, total: tasks.length })}</span>
      </div>

      <ul className="stk-list" aria-label={`Tasks in ${title}`}>
        {visible.map((task) => (
          <li key={`${task.text}\u0000${task.nth}`} className={`stk-task${task.checked ? ' is-done' : ''}`} style={{ '--depth': task.depth }}>
            <label>
              <input type="checkbox" className="nt-check is-small" checked={task.checked} onChange={() => toggle(task)} />
              <span className="stk-task-text">{task.text}</span>
            </label>
            <PriorityMarks priority={task.priority} />
            <DueChip due={task.due} today={today} checked={task.checked} />
          </li>
        ))}
        {!tasks.length && <li className="stk-empty">No tasks yet.</li>}
        {tasks.length > 0 && !visible.length && <li className="stk-empty">All tasks completed.</li>}
      </ul>

      <form className="stk-add" onSubmit={add}>
        <PlusIcon size={13} />
        <input ref={addRef} type="text" placeholder="Add a task" aria-label={`Add a task to ${title}`} />
      </form>

      {menu && <PopupMenu anchor={menu} items={menuItems} label={`${title} options`} onClose={() => setMenu(null)} />}
    </section>
  );
}

export default function StickyLayer() {
  const { cards } = useStickies();
  const { status, notes } = useNotes();
  const { today } = useToday();
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // A card whose note was deleted (here, in another tab, or by a restore) goes too.
  useEffect(() => {
    if (status === 'ready') pruneStickies(notes.map((n) => n.id));
  }, [status, notes]);

  const byId = useMemo(() => new Map(notes.map((n) => [String(n.id), n])), [notes]);
  if (status !== 'ready') return null;
  return Object.entries(cards).map(([id, card]) => {
    const note = byId.get(id);
    return note ? <StickyNote key={id} note={note} card={card} today={today} viewport={viewport} /> : null;
  });
}
