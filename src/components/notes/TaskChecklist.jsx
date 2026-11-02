import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  PRIORITIES,
  addDays,
  addTask,
  checklistSegments,
  clearCompleted,
  deleteTask,
  dueLabel,
  dueState,
  moveTask,
  parseTasks,
  progressLabel,
  refOf,
  setDue,
  setPriority,
  setTaskText,
  toggleChecked,
} from '../../libs/notes/tasks';
import PopupMenu from './PopupMenu';
import { CalendarIcon, GripIcon, MoreIcon, OverdueIcon, PlusIcon } from './notesIcons';
import '../../styles/notes-tasks.css';

// A Task Note's Checklist view: the note's Markdown with each run of checklist lines shown
// as interactive tasks (tick, edit, reorder, due date, priority, delete) and the rest
// rendered as in Preview, in the order written. Every change rewrites the Markdown through
// tasks.js and goes back through the editor (onChange), so it is saved, and undoable,
// like typing.

const keyOf = (t) => `${t.text}\u0000${t.nth}`;

// The sibling task to swap with for Alt+↑ / Alt+↓, as a moveTask target index.
function keyboardTarget(tasks, task, direction) {
  if (direction < 0) {
    const prev = [...tasks].reverse().find((t) => t.index < task.index && t.depth <= task.depth);
    return prev ? prev.index : null;
  }
  const next = tasks.find((t) => t.index > task.index && t.depth <= task.depth);
  if (!next) return null;
  const after = tasks.find((t) => t.index > next.index && t.depth <= next.depth);
  return after ? after.index : tasks.length;
}

export function DueChip({ due, today, checked, onClick }) {
  if (!due) return null;
  const state = checked ? null : dueState(due, today);
  const Glyph = state === 'overdue' ? OverdueIcon : CalendarIcon;
  const label = dueLabel(due, today);
  const title = `${state === 'overdue' ? 'Overdue: was due' : 'Due'} ${label === 'Today' || label === 'Tomorrow' || label === 'Yesterday' ? label.toLowerCase() : label} (${due})`;
  const content = (
    <>
      <Glyph size={12} stroke={2} />
      <span>{state === 'overdue' ? `Overdue · ${label}` : label}</span>
    </>
  );
  const className = `ntc-due${state ? ` is-${state}` : ''}`;
  if (!onClick) return <span className={className} title={title}>{content}</span>;
  return <button type="button" className={className} title={`${title}. Change the due date`} onClick={onClick}>{content}</button>;
}

export function PriorityMarks({ priority }) {
  if (!priority) return null;
  const { label, marks } = PRIORITIES[priority];
  return <span className={`ntc-priority is-p${priority}`} title={`${label} priority`}><span aria-hidden="true">{marks}</span><span className="nt-sr">{label} priority</span></span>;
}

export function ProgressBar({ done, total, className = '' }) {
  if (!total) return null;
  return (
    <span className={`nt-progress ${className}`} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={progressLabel({ done, total })}>
      <span style={{ width: `${(done / total) * 100}%` }} />
    </span>
  );
}

function TaskRow({ task, today, dragging, onAction, onDragStart }) {
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [menu, setMenu] = useState(null);
  const dateRef = useRef(null);
  const ref = refOf(task);

  useEffect(() => {
    if (!picking) return;
    const el = dateRef.current;
    el?.focus();
    try {
      el?.showPicker?.();
    } catch {
      /* needs a user gesture in some browsers: the field is there to type in */
    }
  }, [picking]);

  const commitText = (value) => {
    setEditing(false);
    if (value.trim() && value.trim() !== task.text) onAction('text', ref, value);
  };

  const menuItems = [
    { type: 'header', label: 'Due Date' },
    { label: 'Today', checked: task.due === today, onSelect: () => onAction('due', ref, today) },
    { label: 'Tomorrow', checked: task.due === addDays(today, 1), onSelect: () => onAction('due', ref, addDays(today, 1)) },
    { label: 'Next Week', checked: task.due === addDays(today, 7), onSelect: () => onAction('due', ref, addDays(today, 7)) },
    { label: 'Choose a Date…', onSelect: () => setPicking(true) },
    task.due && { label: 'Remove Due Date', onSelect: () => onAction('due', ref, null) },
    { type: 'separator' },
    { type: 'header', label: 'Priority' },
    ...PRIORITIES.map((p) => ({ label: p.marks ? `${p.label}  ${p.marks}` : p.label, checked: task.priority === p.value, onSelect: () => onAction('priority', ref, p.value) })),
    { type: 'separator' },
    { label: 'Edit Text', onSelect: () => setEditing(true) },
    { label: 'Delete Task', danger: true, onSelect: () => onAction('delete', ref) },
  ];

  const onKeyDown = (e) => {
    if (editing || (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox')) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      onAction('move-key', ref, e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      onAction('focus', ref, e.key === 'ArrowUp' ? -1 : 1);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && e.target.type === 'checkbox') {
      e.preventDefault();
      onAction('delete', ref);
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      onAction('toggle', ref);
    } else if (e.key === 'Enter' && e.target.type === 'checkbox') {
      e.preventDefault();
      setEditing(true);
    }
  };

  return (
    <li
      className={`ntc-row${task.checked ? ' is-done' : ''}${dragging ? ' is-dragging' : ''}`}
      data-task-index={task.index}
      style={{ '--depth': task.depth }}
      onKeyDown={onKeyDown}
    >
      <span
        className="ntc-grip"
        title="Drag to reorder (or Alt+↑ / Alt+↓)"
        aria-hidden="true"
        onPointerDown={(e) => onDragStart(e, task)}
      >
        <GripIcon size={14} />
      </span>
      <input
        type="checkbox"
        className="nt-check"
        checked={task.checked}
        aria-label={task.text}
        onChange={() => onAction('toggle', ref)}
      />
      {editing ? (
        <input
          className="ntc-edit"
          defaultValue={task.text}
          aria-label="Task text"
          autoFocus
          onFocus={(e) => e.target.select()}
          onBlur={(e) => commitText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitText(e.currentTarget.value);
              e.currentTarget.closest('li')?.querySelector('.nt-check')?.focus();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setEditing(false);
            }
          }}
        />
      ) : (
        <button type="button" className="ntc-text" title="Edit" onClick={() => setEditing(true)}>
          {task.text}
        </button>
      )}
      <span className="ntc-meta">
        <PriorityMarks priority={task.priority} />
        {picking ? (
          <input
            ref={dateRef}
            type="date"
            className="ntc-date"
            aria-label="Due date"
            defaultValue={task.due || today}
            onChange={(e) => e.target.value && onAction('due', ref, e.target.value)}
            onBlur={() => setPicking(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' || e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                setPicking(false);
              }
            }}
          />
        ) : (
          <DueChip due={task.due} today={today} checked={task.checked} onClick={() => setPicking(true)} />
        )}
      </span>
      <button
        type="button"
        className="ntc-more"
        aria-label={`Options for ${task.text}`}
        aria-haspopup="menu"
        aria-expanded={Boolean(menu)}
        title="Due date, priority, delete"
        onClick={(e) => setMenu(menu ? null : e.currentTarget)}
      >
        <MoreIcon size={14} />
      </button>
      {menu && <PopupMenu anchor={menu} items={menuItems} label="Task options" onClose={() => setMenu(null)} />}
    </li>
  );
}

export default function TaskChecklist({ content, today, onChange, renderMarkdown, hideDone, onHideDoneChange, onUndoKeys }) {
  const listRef = useRef(null);
  const addRef = useRef(null);
  const [drag, setDrag] = useState(null); // { key, target }
  const tasks = useMemo(() => parseTasks(content), [content]);
  const segments = useMemo(() => checklistSegments(content, tasks), [content, tasks]);
  const html = useMemo(() => {
    const out = new Map();
    if (!renderMarkdown) return out;
    for (const s of segments) if (s.type === 'md') out.set(s.key, renderMarkdown(s.text));
    return out;
  }, [segments, renderMarkdown]);
  const done = tasks.filter((t) => t.checked).length;

  // Latest content for handlers that run after a render (a drag, a menu choice).
  const contentRef = useRef(content);
  useLayoutEffect(() => {
    contentRef.current = content;
  }, [content]);

  const focusRow = (index, selector = '.nt-check') => {
    requestAnimationFrame(() => {
      listRef.current?.querySelector(`[data-task-index="${index}"] ${selector}`)?.focus();
    });
  };

  const onAction = (action, ref, value) => {
    const src = contentRef.current;
    if (action === 'toggle') onChange(toggleChecked(src, ref));
    else if (action === 'text') onChange(setTaskText(src, ref, value), 'edit');
    else if (action === 'due') onChange(setDue(src, ref, value));
    else if (action === 'priority') onChange(setPriority(src, ref, value));
    else if (action === 'delete') {
      onChange(deleteTask(src, ref));
      focusRow(Math.max(0, ref.index - 1));
    } else if (action === 'move-key') {
      const all = parseTasks(src);
      const task = all.find((t) => t.index === ref.index);
      const target = task && keyboardTarget(all, task, value);
      if (target !== null && target !== undefined) onChange(moveTask(src, ref, target));
    } else if (action === 'focus') {
      const rows = [...listRef.current.querySelectorAll('[data-task-index]')];
      const i = rows.findIndex((r) => Number(r.dataset.taskIndex) === ref.index);
      rows[i + value]?.querySelector('.nt-check')?.focus();
    }
  };

  // Drag to reorder: the row follows the pointer; a line shows where it will land.
  const onDragStart = (e, task) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const row = handle.closest('li');
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    let frame = 0;
    let target = null;
    setDrag({ key: keyOf(task), target: null });
    const move = (ev) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        row.style.transform = `translateY(${ev.clientY - startY}px)`;
        const rows = [...listRef.current.querySelectorAll('[data-task-index]')].filter((r) => r !== row);
        const next = rows.find((r) => {
          const b = r.getBoundingClientRect();
          return ev.clientY < b.top + b.height / 2;
        });
        target = next ? Number(next.dataset.taskIndex) : parseTasks(contentRef.current).length;
        setDrag((d) => (d && d.target !== target ? { ...d, target } : d));
      });
    };
    const end = (ev) => {
      cancelAnimationFrame(frame);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      row.style.transform = '';
      setDrag(null);
      if (ev.type === 'pointerup' && target !== null) onChange(moveTask(contentRef.current, refOf(task), target));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };

  const addFromField = (e) => {
    e.preventDefault();
    const value = addRef.current.value.trim();
    if (!value) return;
    onChange(addTask(contentRef.current, value));
    addRef.current.value = '';
  };

  const clear = () => {
    if (!done) return;
    if (window.confirm(`Delete ${done === 1 ? 'the completed task' : `the ${done} completed tasks`} from this note?`)) onChange(clearCompleted(contentRef.current));
  };

  const hiddenCount = hideDone ? done : 0;

  return (
    <div className="ntc custom-scrollbar" onKeyDown={onUndoKeys}>
      <div className="ntc-summary">
        <div className="ntc-summary-text">
          <span className="ntc-summary-label">{progressLabel({ done, total: tasks.length })}</span>
          <ProgressBar done={done} total={tasks.length} />
        </div>
        <div className="ntc-summary-actions">
          <button type="button" className="nt-text-btn" aria-pressed={hideDone} onClick={() => onHideDoneChange(!hideDone)} disabled={!done && !hideDone}>
            {hideDone ? 'Show Completed' : 'Hide Completed'}
          </button>
          <button type="button" className="nt-text-btn" onClick={clear} disabled={!done}>
            Clear Completed…
          </button>
        </div>
      </div>

      <div ref={listRef} className="ntc-body">
        {segments.map((s) => {
          if (s.type === 'md') {
            return renderMarkdown
              ? <div key={s.key} className="notes-md-preview ntc-md" dangerouslySetInnerHTML={{ __html: html.get(s.key) }} />
              : <div key={s.key} className="notes-md-preview ntc-md"><p>{s.text}</p></div>;
          }
          const visible = hideDone ? s.tasks.filter((t) => !t.checked) : s.tasks;
          if (!visible.length) return null;
          return (
            <ul key={s.key} className="ntc-list" aria-label="Tasks">
              {visible.map((task) => (
                <TaskRowSlot key={keyOf(task)} task={task} drag={drag} today={today} onAction={onAction} onDragStart={onDragStart} />
              ))}
            </ul>
          );
        })}
        {drag && drag.target === tasks.length && <div className="ntc-drop is-end" aria-hidden="true" />}
        {!tasks.length && <p className="ntc-empty">No tasks yet. Add the first one below.</p>}
        {hiddenCount > 0 && <p className="ntc-hidden-note">{hiddenCount} completed {hiddenCount === 1 ? 'task' : 'tasks'} hidden</p>}
      </div>

      <form className="ntc-add" onSubmit={addFromField}>
        <PlusIcon size={15} />
        <input ref={addRef} type="text" placeholder="Add a task" aria-label="Add a task" enterKeyHint="done" />
      </form>
    </div>
  );
}

// The drop line goes above the row the dragged task will land before.
function TaskRowSlot({ task, drag, today, onAction, onDragStart }) {
  const dragging = drag?.key === keyOf(task);
  return (
    <>
      {drag && !dragging && drag.target === task.index && <li className="ntc-drop" aria-hidden="true" style={{ '--depth': task.depth }} />}
      <TaskRow task={task} today={today} dragging={dragging} onAction={onAction} onDragStart={onDragStart} />
    </>
  );
}
