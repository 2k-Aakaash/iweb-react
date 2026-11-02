import { describe, expect, it } from 'vitest';
import { filterView, listSections, noteInfo, searchNotes, taskKey, tasksForView, validView, viewCounts } from '../views';

const NOW = new Date(2026, 10, 2, 15, 0).getTime(); // Mon 2 Nov 2026, 3 PM local
const TODAY = '2026-11-02';
const at = (d, h = 10) => new Date(2026, 10, d, h).getTime();

const notes = [
  { id: 1, title: 'Daily', kind: 'task', updatedAt: at(2, 9), createdAt: at(1), content: '- [ ] standup 📅 2026-11-02\n- [ ] report !!! 📅 2026-10-30\n- [x] email 📅 2026-11-02' },
  { id: 2, title: 'Trip', kind: 'task', updatedAt: at(1), content: '- [x] book\n- [x] pack' },
  { id: 3, title: 'ideas', updatedAt: at(2, 11), content: 'Write about #work and #Home.\n- [ ] later 📅 2026-11-20', pinned: true },
  { id: 4, title: 'Archive', updatedAt: at(1, 8), content: 'Old #work stuff' },
  { id: 5, title: 'Empty tasks', kind: 'task', updatedAt: at(1, 7), content: '' },
];
const ids = (list) => list.map((n) => n.id);

describe('noteInfo', () => {
  it('summarizes once per record', () => {
    const info = noteInfo(notes[0]);
    expect(info).toBe(noteInfo(notes[0]));
    expect(info).toMatchObject({ isTask: true, done: 1, total: 3, nextDue: '2026-10-30', topPriority: 3 });
    expect(noteInfo(notes[2]).tags).toEqual(['work', 'home']);
    // A changed note is a new record: a new summary.
    expect(noteInfo({ ...notes[0], content: '- [x] a' })).toMatchObject({ done: 1, total: 1 });
  });
});

describe('views', () => {
  it('filters notes into each view', () => {
    expect(ids(filterView(notes, 'all', TODAY))).toEqual([1, 2, 3, 4, 5]);
    expect(ids(filterView(notes, 'pinned', TODAY))).toEqual([3]);
    expect(ids(filterView(notes, 'tasks', TODAY))).toEqual([1, 2, 5]);
    expect(ids(filterView(notes, 'today', TODAY))).toEqual([1]);
    expect(ids(filterView(notes, 'overdue', TODAY))).toEqual([1]);
    expect(ids(filterView(notes, 'upcoming', TODAY))).toEqual([3]);
    expect(ids(filterView(notes, 'completed', TODAY))).toEqual([2]);
    expect(ids(filterView(notes, 'tag:work', TODAY))).toEqual([3, 4]);
  });

  it('lists the open tasks that put a note in a date view', () => {
    expect(tasksForView(notes[0], 'today', TODAY).map((t) => t.text)).toEqual(['standup']);
    expect(tasksForView(notes[0], 'overdue', TODAY).map((t) => t.text)).toEqual(['report']);
    expect(tasksForView(notes[0], 'tasks', TODAY)).toEqual([]);
  });

  it('keeps a task ticked in a date view there until the view changes', () => {
    const ticked = { ...notes[0], content: notes[0].content.replace('- [ ] standup', '- [x] standup') };
    const task = noteInfo(ticked).tasks[0];
    expect(tasksForView(ticked, 'today', TODAY)).toEqual([]);
    const keep = new Set([taskKey(ticked, task)]);
    expect(tasksForView(ticked, 'today', TODAY, keep).map((t) => [t.text, t.checked])).toEqual([['standup', true]]);
    const onlyTicked = { ...ticked, id: 9, content: '- [x] standup 📅 2026-11-02' };
    expect(ids(filterView([onlyTicked], 'today', TODAY))).toEqual([]);
    expect(ids(filterView([onlyTicked], 'today', TODAY, new Set([9])))).toEqual([9]);
  });

  it('shows task text, not date or priority marks, in snippets', () => {
    expect(noteInfo(notes[0]).snippet).toBe('standup report email');
  });

  it('counts for the sidebar', () => {
    const counts = viewCounts(notes, TODAY);
    expect(counts).toMatchObject({ all: 5, pinned: 1, tasks: 3, completed: 1, today: 1, overdue: 1, upcoming: 1 });
    expect(counts.tags).toEqual([{ name: 'work', count: 2 }, { name: 'home', count: 1 }]);
    expect(validView('tag:work', counts)).toBe('tag:work');
    expect(validView('tag:gone', counts)).toBe('all');
    expect(validView('nonsense', counts)).toBe('all');
  });

  it('searches title and text for every word', () => {
    expect(ids(searchNotes(notes, 'IDEAS'))).toEqual([3]);
    expect(ids(searchNotes(notes, 'work stuff'))).toEqual([4]);
    expect(ids(searchNotes(notes, '  '))).toEqual(ids(notes));
  });
});

describe('listSections', () => {
  it('puts pinned notes first, then dated sections', () => {
    const sections = listSections(notes, { sort: 'edited', now: NOW });
    expect(sections.map((s) => s.label)).toEqual(['Pinned', 'Today', 'Yesterday']);
    expect(ids(sections[1].notes)).toEqual([1]);
    expect(ids(sections[2].notes)).toEqual([2, 4, 5]);
  });

  it('does not repeat the Pinned section in the Pinned view', () => {
    expect(listSections([notes[2]], { view: 'pinned', now: NOW }).map((s) => s.label)).toEqual(['Today']);
  });

  it('sorts by title, created date and due date', () => {
    expect(listSections(notes, { sort: 'title', now: NOW }).map((s) => [s.label, ids(s.notes)])).toEqual([['Pinned', [3]], ['Notes', [4, 1, 5, 2]]]);
    const created = listSections(notes.filter((n) => !n.pinned), { sort: 'created', now: NOW });
    expect(created.map((s) => s.label)).toEqual(['Yesterday']); // note 1 was created on the 1st
    expect(ids(created[0].notes)[0]).toBe(1);
    const due = listSections(notes.filter((n) => !n.pinned), { sort: 'due', now: NOW });
    expect(due.map((s) => [s.label, ids(s.notes)])).toEqual([['Overdue', [1]], ['No Due Date', [2, 4, 5]]]);
  });
});
