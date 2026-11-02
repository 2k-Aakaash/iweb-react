import { memo, useEffect, useRef, useState } from 'react';
import { rowDate } from '../../libs/notes/groups';
import { DATE_VIEWS, noteInfo, tasksForView } from '../../libs/notes/views';
import { DueChip, PriorityMarks, ProgressBar } from './TaskChecklist';
import { ChecklistIcon, DesktopIcon, MoreIcon, PinIcon } from './notesIcons';

// The middle column: the selected view's notes in sections (Pinned first, then by date,
// title or due date). A row shows the title, date and a snippet; a Task Note also shows its
// progress and next due date, and in Today / Overdue / Upcoming the tasks that put it there,
// ready to tick. Rows are memoized: typing in the editor doesn't re-render the list.

const NoteRow = memo(function NoteRow({ note, active, view, today, now, onDesktop, keep, onAction }) {
  const info = noteInfo(note);
  const dated = DATE_VIEWS.includes(view) ? tasksForView(note, view, today, keep) : [];
  const title = note.title.trim() || 'Untitled Note';
  return (
    <li className={`nsb-row ntl-row${active ? ' is-active' : ''}`} data-note-id={note.id}>
      <button
        type="button"
        className="nsb-row-main"
        aria-current={active ? 'true' : undefined}
        onClick={() => onAction('select', note)}
        onContextMenu={(e) => {
          e.preventDefault();
          onAction('menu', note, { x: e.clientX, y: e.clientY });
        }}
      >
        <span className="ntl-title-line">
          {info.isTask && <ChecklistIcon size={13} className="ntl-kind" />}
          <span className="nsb-row-title">{title}</span>
          {note.pinned && <PinIcon size={12} filled className="ntl-flag" />}
          {onDesktop && <DesktopIcon size={13} className="ntl-flag" />}
        </span>
        <span className="nsb-row-sub">
          <span className="nsb-row-date">{rowDate(note.updatedAt, now)}</span>
          <span className="nsb-row-snippet">{info.snippet || 'No additional text'}</span>
        </span>
        {info.isTask && info.total > 0 && (
          <span className="ntl-task-line">
            <ProgressBar done={info.done} total={info.total} className="is-small" />
            <span className="ntl-task-count">{info.done === info.total ? 'All done' : `${info.done}/${info.total}`}</span>
            <PriorityMarks priority={info.topPriority} />
            <DueChip due={info.nextDue} today={today} />
          </span>
        )}
        {onDesktop && <span className="nt-sr">On the desktop.</span>}
      </button>
      <button
        type="button"
        className="nsb-row-delete ntl-more"
        title="More"
        aria-label={`More for ${title}`}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          onAction('menu', note, e.currentTarget);
        }}
      >
        <MoreIcon size={14} />
      </button>
      {dated.length > 0 && (
        <ul className="ntl-tasks" aria-label={`Tasks in ${title}`}>
          {dated.map((task) => (
            <li key={`${task.text}\u0000${task.nth}`} className={`ntl-task${task.checked ? ' is-done' : ''}`}>
              <input
                type="checkbox"
                className="nt-check is-small"
                checked={task.checked}
                aria-label={task.text}
                onChange={() => onAction('toggle', note, task)}
              />
              <span className="ntl-task-text">{task.text}</span>
              <PriorityMarks priority={task.priority} />
              <DueChip due={task.due} today={today} checked={task.checked} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
});

// Rows are added as the list scrolls (PAGE at a time, a screen ahead), so a long list opens
// and switches views quickly. The open note is always among the rendered rows.
const PAGE = 60;

function NoteList({ sections, activeId, view, today, now, desktopIds, keep, onAction, emptyText }) {
  const [limit, setLimit] = useState(PAGE);
  const sentinelRef = useRef(null);
  const total = sections.reduce((n, s) => n + s.notes.length, 0);
  let activeAt = -1;
  let at = 0;
  for (const section of sections) {
    const i = section.notes.findIndex((n) => n.id === activeId);
    if (i !== -1) activeAt = at + i;
    at += section.notes.length;
  }
  const shown = Math.max(limit, activeAt + PAGE / 2);

  useEffect(() => {
    const list = sentinelRef.current?.closest('.nsb-list');
    if (!list) return undefined;
    // Within 800px of the end (or not filling the list yet): the next page.
    const check = () => {
      if (list.clientHeight && list.scrollTop + list.clientHeight > list.scrollHeight - 800) setLimit((l) => l + PAGE);
    };
    const frame = requestAnimationFrame(check);
    list.addEventListener('scroll', check, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      list.removeEventListener('scroll', check);
    };
  }, [shown, total]);

  if (!sections.length) return emptyText ? <div className="nsb-empty">{emptyText}</div> : null;
  let left = shown;
  const out = [];
  for (const [i, section] of sections.entries()) {
    if (left <= 0) break;
    const notes = section.notes.slice(0, left);
    left -= notes.length;
    out.push(
      <section key={section.label || i} className="nsb-group" aria-label={section.label || 'Notes'}>
        {section.label && <h3 className="nsb-group-title">{section.label}</h3>}
        <ul className="nsb-rows">
          {notes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              active={note.id === activeId}
              view={view}
              today={today}
              now={now}
              onDesktop={desktopIds.has(String(note.id))}
              keep={keep}
              onAction={onAction}
            />
          ))}
        </ul>
      </section>,
    );
  }
  if (total > shown) out.push(<div key="more" ref={sentinelRef} className="ntl-more-rows" aria-hidden="true" />);
  return out;
}

export default memo(NoteList);
