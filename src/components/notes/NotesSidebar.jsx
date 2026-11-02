import { VIEWS } from '../../libs/notes/views';
import {
  CalendarIcon,
  ChecklistIcon,
  CompletedIcon,
  ComposeIcon,
  NewTaskIcon,
  NotesIcon,
  OverdueIcon,
  PinIcon,
  TagIcon,
  TodayIcon,
} from './notesIcons';

// The Notes sidebar: new note / new task, the library (All Notes, Pinned), the task views
// (Today, Overdue, Upcoming, All Tasks, Completed) and tags. A view only shows when it has
// something in it, except the ones that are always useful (All Notes, Today, All Tasks)
// and the one that's selected.

const LIBRARY = [
  ['all', NotesIcon, true],
  ['pinned', PinIcon, false],
];
const TASKS = [
  ['today', TodayIcon, true],
  ['overdue', OverdueIcon, false],
  ['upcoming', CalendarIcon, false],
  ['tasks', ChecklistIcon, true],
  ['completed', CompletedIcon, false],
];

function ViewButton({ id, label, Icon, count, selected, onSelect, tone }) {
  return (
    <li>
      <button
        type="button"
        className={`ntn-item${selected ? ' is-selected' : ''}${tone ? ` is-${tone}` : ''}`}
        aria-current={selected ? 'page' : undefined}
        onClick={() => onSelect(id)}
      >
        <Icon size={16} />
        <span className="ntn-label">{label}</span>
        {count > 0 && <span className="ntn-count">{count}</span>}
      </button>
    </li>
  );
}

export default function NotesSidebar({ counts, view, onView, onNewNote, onNewTask, disabled }) {
  const section = (items) => items
    .filter(([id, , always]) => always || counts[id] > 0 || view === id)
    .map(([id, Icon]) => (
      <ViewButton
        key={id}
        id={id}
        label={VIEWS[id].label}
        Icon={Icon}
        count={counts[id]}
        selected={view === id}
        onSelect={onView}
        tone={id === 'overdue' && counts.overdue > 0 ? 'alert' : null}
      />
    ));

  return (
    <nav className="ntn" aria-label="Notes views">
      <div className="ntn-new">
        <button type="button" className="ntn-new-btn" onClick={onNewNote} disabled={disabled} title="New Note (Ctrl+N)">
          <ComposeIcon size={15} />
          <span>Note</span>
        </button>
        <button type="button" className="ntn-new-btn" onClick={onNewTask} disabled={disabled} title="New Task Note (Ctrl+Alt+N)">
          <NewTaskIcon size={15} />
          <span>Task</span>
        </button>
      </div>
      <div className="ntn-scroll custom-scrollbar">
        <h3 className="ntn-heading">Library</h3>
        <ul className="ntn-list">{section(LIBRARY)}</ul>
        <h3 className="ntn-heading">Tasks</h3>
        <ul className="ntn-list">{section(TASKS)}</ul>
        {counts.tags.length > 0 && (
          <>
            <h3 className="ntn-heading">Tags</h3>
            <ul className="ntn-list">
              {counts.tags.map((tag) => (
                <ViewButton
                  key={tag.name}
                  id={`tag:${tag.name}`}
                  label={tag.name}
                  Icon={TagIcon}
                  count={tag.count}
                  selected={view === `tag:${tag.name}`}
                  onSelect={onView}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </nav>
  );
}
