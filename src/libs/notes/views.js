// What the Notes sidebar and list show: a summary of each note (cached per record, so the
// list never re-parses a note that didn't change), the sidebar's views and their counts,
// search, and the list's sort and sections. Pure functions; the window is Notes.jsx.
import { groupNotes } from './groups';
import { markdownToText } from './markdown';
import { addDays, dayKey, dueState, parseTags, parseTasks } from './tasks';

const SNIPPET = 160;
const cache = new WeakMap();

/** Summary of a note: snippet, tasks and progress, next due date, tags, search text. */
export function noteInfo(note) {
  let info = cache.get(note);
  if (info) return info;
  const tasks = parseTasks(note.content);
  const open = tasks.filter((t) => !t.checked);
  // Task lines read as their text in the snippet (no 📅 dates or !! marks).
  let source = note.content;
  if (tasks.length) {
    const lines = source.split('\n');
    for (const t of tasks) lines[t.line] = `- ${t.text}`;
    source = lines.join('\n');
  }
  const text = markdownToText(source);
  const dues = open.map((t) => t.due).filter(Boolean).sort();
  info = {
    isTask: note.kind === 'task',
    snippet: text.length > SNIPPET ? `${text.slice(0, SNIPPET)}…` : text,
    words: text ? text.split(/\s+/).length : 0,
    tasks,
    done: tasks.length - open.length,
    total: tasks.length,
    nextDue: dues[0] || null,
    topPriority: open.reduce((p, t) => Math.max(p, t.priority), 0),
    tags: parseTags(note.content),
    search: `${note.title}\n${note.content}`.toLowerCase(),
  };
  cache.set(note, info);
  return info;
}

export const createdAt = (note) => note.createdAt ?? note.updatedAt ?? 0;

// ---- Views ---------------------------------------------------------------------------------

export const DATE_VIEWS = ['today', 'overdue', 'upcoming'];

export const VIEWS = Object.freeze({
  all: { label: 'All Notes', empty: 'No Notes' },
  pinned: { label: 'Pinned', empty: 'No pinned notes' },
  today: { label: 'Today', empty: 'Nothing due today' },
  overdue: { label: 'Overdue', empty: 'Nothing overdue' },
  upcoming: { label: 'Upcoming', empty: 'Nothing coming up' },
  tasks: { label: 'All Tasks', empty: 'No Task Notes yet' },
  completed: { label: 'Completed', empty: 'No completed Task Notes' },
});

export const isTagView = (view) => typeof view === 'string' && view.startsWith('tag:');

export function viewLabel(view) {
  if (isTagView(view)) return `#${view.slice(4)}`;
  return VIEWS[view]?.label || VIEWS.all.label;
}

/** Open tasks of a note that belong in a date view (Today, Overdue, Upcoming). */
/** Identifies a task across edits of its note (for keeping a ticked task in view). */
export const taskKey = (note, task) => `${note.id}\u0000${task.text}\u0000${task.nth}`;

/**
 * Open tasks of a note that belong in a date view (Today, Overdue, Upcoming). `keep` (a Set
 * of taskKey) holds tasks ticked in this view just now: they stay, done, until the view
 * changes, as in Reminders.
 */
export function tasksForView(note, view, today = dayKey(), keep = null) {
  if (!DATE_VIEWS.includes(view)) return [];
  return noteInfo(note).tasks.filter((t) => (!t.checked && dueState(t.due, today) === view) || keep?.has(taskKey(note, t)));
}

function inView(note, view, today) {
  const info = noteInfo(note);
  if (view === 'all') return true;
  if (view === 'pinned') return Boolean(note.pinned);
  if (view === 'tasks') return info.isTask;
  if (view === 'completed') return info.isTask && info.total > 0 && info.done === info.total;
  if (DATE_VIEWS.includes(view)) return tasksForView(note, view, today).length > 0;
  if (isTagView(view)) return info.tags.includes(view.slice(4));
  return false;
}

/** Notes in a view; `keepIds` (note ids) stay in it too (see tasksForView). */
export function filterView(notes, view, today = dayKey(), keepIds = null) {
  return notes.filter((note) => inView(note, view, today) || keepIds?.has(note.id));
}

/** Counts for the sidebar, and the tags in use (most used first). */
export function viewCounts(notes, today = dayKey()) {
  const counts = { all: notes.length, pinned: 0, today: 0, overdue: 0, upcoming: 0, tasks: 0, completed: 0 };
  const tags = new Map();
  for (const note of notes) {
    const info = noteInfo(note);
    if (note.pinned) counts.pinned++;
    if (info.isTask) counts.tasks++;
    if (info.isTask && info.total > 0 && info.done === info.total) counts.completed++;
    for (const t of info.tasks) {
      if (t.checked) continue;
      const state = dueState(t.due, today);
      if (state) counts[state]++;
    }
    for (const tag of info.tags) tags.set(tag, (tags.get(tag) || 0) + 1);
  }
  counts.tags = [...tags].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
  return counts;
}

/** A view that still makes sense, falling back to All Notes (a tag that's gone…). */
export function validView(view, counts) {
  if (VIEWS[view]) return view;
  if (isTagView(view) && counts.tags.some((t) => t.name === view.slice(4))) return view;
  return 'all';
}

/** Notes whose title or text contain every word of the query. */
export function searchNotes(notes, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return notes;
  return notes.filter((note) => {
    const { search } = noteInfo(note);
    return words.every((w) => search.includes(w));
  });
}

// ---- Sort and sections ---------------------------------------------------------------------

export const SORTS = Object.freeze([
  { id: 'edited', label: 'Date Edited' },
  { id: 'created', label: 'Date Created' },
  { id: 'title', label: 'Title' },
  { id: 'due', label: 'Due Date' },
]);

const byTitle = (a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base', numeric: true });

function dueSection(due, today) {
  if (!due) return 'No Due Date';
  if (due < today) return 'Overdue';
  if (due === today) return 'Today';
  if (due === addDays(today, 1)) return 'Tomorrow';
  if (due <= addDays(today, 7)) return 'Next 7 Days';
  return 'Later';
}

/**
 * The list's sections: [{ label, notes }]. Pinned notes come first in their own section
 * (as in macOS Notes) except in the Pinned view; then by the sort: dated sections for the
 * dates, A–Z for titles, due-date buckets for Due Date.
 */
export function listSections(notes, { sort = 'edited', view = 'all', now = Date.now() } = {}) {
  const today = dayKey(new Date(now));
  const pinnedFirst = view !== 'pinned';
  const pinned = pinnedFirst ? notes.filter((n) => n.pinned) : [];
  const rest = pinnedFirst ? notes.filter((n) => !n.pinned) : notes;
  const sections = [];
  const sortSection = (list) => {
    if (sort === 'title') return [...list].sort(byTitle);
    if (sort === 'created') return [...list].sort((a, b) => createdAt(b) - createdAt(a));
    if (sort === 'due') return [...list].sort((a, b) => (noteInfo(a).nextDue || '9999') .localeCompare(noteInfo(b).nextDue || '9999') || b.updatedAt - a.updatedAt);
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  };
  if (pinned.length) sections.push({ label: 'Pinned', notes: sortSection(pinned) });
  if (!rest.length) return sections;
  if (sort === 'title') {
    sections.push({ label: pinned.length ? 'Notes' : null, notes: sortSection(rest) });
  } else if (sort === 'due') {
    for (const note of sortSection(rest)) {
      const label = dueSection(noteInfo(note).nextDue, today);
      const last = sections[sections.length - 1];
      if (last && last.label === label && last.due) last.notes.push(note);
      else sections.push({ label, notes: [note], due: true });
    }
  } else {
    sections.push(...groupNotes(rest, now, sort === 'created' ? createdAt : undefined));
  }
  return sections;
}
