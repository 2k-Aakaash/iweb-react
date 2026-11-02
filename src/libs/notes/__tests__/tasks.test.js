import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import {
  addDays,
  addTask,
  checklistSegments,
  clearCompleted,
  dayKey,
  deleteTask,
  dueLabel,
  dueState,
  formatTask,
  moveTask,
  parseTags,
  parseTasks,
  progressLabel,
  refOf,
  resolveTask,
  setChecked,
  setDue,
  setPriority,
  setTaskText,
  splitMeta,
  taskProgress,
  toggleChecked,
} from '../tasks';

const NOTE = [
  "# Today's Tasks",
  '',
  '- [ ] Finish API integration',
  '- [ ] Review pull request !! 📅 2026-11-03',
  '- [x] Fix login issue',
  '  - [ ] Write regression test',
  '- [ ] Prepare deployment notes',
].join('\n');

const texts = (src) => parseTasks(src).map((t) => `${t.checked ? 'x' : ''} ${t.text}`);

describe('parseTasks', () => {
  it('reads checklist lines with their state, depth and metadata', () => {
    const tasks = parseTasks(NOTE);
    expect(tasks.map((t) => t.text)).toEqual(['Finish API integration', 'Review pull request', 'Fix login issue', 'Write regression test', 'Prepare deployment notes']);
    expect(tasks[1]).toMatchObject({ due: '2026-11-03', priority: 2, checked: false, line: 3 });
    expect(tasks[2].checked).toBe(true);
    expect(tasks[3].depth).toBe(1);
  });

  it('counts exactly the boxes marked renders (code, empty items and missing spaces are not tasks)', () => {
    const cases = [
      '- [ ]\n- [ ] a',
      '- [x]done\n- [X] Up',
      '```\n- [ ] code\n```\n- [ ] a',
      '~~~md\n- [ ] code\n~~~\n- [ ] a',
      'para\n\n    - [ ] code?\n\n- [ ] a',
      '> - [ ] quoted\n- [ ] a',
      '* [ ] s\n+ [ ] p\n1. [ ] n\n2) [x] m',
      '- [ ] a\n  - [x] b\n    - [ ] c',
      '- [ ] a\n- plain\n- [ ] b',
      '-\t[ ] tab',
      'text\n- [ ] after a paragraph',
      '- [ ] a\n\n- [ ] loose',
    ];
    for (const src of cases) {
      const rendered = (marked.parse(src).match(/type="checkbox"/g) || []).length;
      expect(parseTasks(src).length, src).toBe(rendered);
    }
  });

  it('handles Windows line endings', () => {
    const tasks = parseTasks('- [ ] one\r\n- [x] two\r\n');
    expect(tasks.map((t) => t.text)).toEqual(['one', 'two']);
    expect(toggleChecked('- [ ] one\r\n- [x] two\r\n', refOf(tasks[0]))).toBe('- [x] one\r\n- [x] two\r\n');
  });
});

describe('metadata', () => {
  it('splits trailing priority and due date in either order', () => {
    expect(splitMeta('Ship it !!! 📅 2026-01-02')).toEqual({ text: 'Ship it', due: '2026-01-02', priority: 3 });
    expect(splitMeta('Ship it 📅 2026-01-02 !')).toEqual({ text: 'Ship it', due: '2026-01-02', priority: 1 });
    expect(splitMeta('Wow!')).toEqual({ text: 'Wow!', due: null, priority: 0 });
    expect(splitMeta('!!')).toEqual({ text: '!!', due: null, priority: 0 });
  });

  it('round-trips a line', () => {
    const [task] = parseTasks('  * [x] Call Sam ! 📅 2026-02-03');
    expect(formatTask(task)).toBe('  * [x] Call Sam ! 📅 2026-02-03');
  });
});

describe('editing', () => {
  it('toggles only the addressed line and keeps everything else byte-for-byte', () => {
    const tasks = parseTasks(NOTE);
    const next = toggleChecked(NOTE, refOf(tasks[0]));
    const changed = next.split('\n').filter((l, i) => l !== NOTE.split('\n')[i]);
    expect(changed).toEqual(['- [x] Finish API integration']);
    expect(setChecked(next, refOf(tasks[0]), false)).toBe(NOTE);
  });

  it('keeps metadata when the text changes, and sets due dates and priorities', () => {
    const tasks = parseTasks(NOTE);
    expect(setTaskText(NOTE, refOf(tasks[1]), 'Review PR #42')).toContain('- [ ] Review PR #42 !! 📅 2026-11-03');
    expect(setTaskText(NOTE, refOf(tasks[1]), '   ')).toBe(NOTE);
    expect(setDue(NOTE, refOf(tasks[0]), '2026-11-05')).toContain('- [ ] Finish API integration 📅 2026-11-05');
    expect(setDue(NOTE, refOf(tasks[1]), null)).toContain('- [ ] Review pull request !!\n');
    expect(setDue(NOTE, refOf(tasks[0]), 'tomorrow')).toBe(NOTE);
    expect(setPriority(NOTE, refOf(tasks[1]), 3)).toContain('- [ ] Review pull request !!! 📅 2026-11-03');
  });

  it('follows a task by its text when the note changed, and skips it when it is gone', () => {
    const tasks = parseTasks(NOTE);
    const ref = refOf(tasks[4]); // Prepare deployment notes
    const edited = NOTE.replace('- [ ] Finish API integration\n', '');
    expect(texts(toggleChecked(edited, ref))).toContain('x Prepare deployment notes');
    const removed = NOTE.replace('- [ ] Prepare deployment notes', '- [ ] Something else');
    expect(toggleChecked(removed, ref)).toBe(removed);
  });

  it('keeps duplicate texts apart by occurrence, then by nearest position', () => {
    const src = '- [ ] milk\n- [ ] eggs\n- [ ] milk';
    const tasks = parseTasks(src);
    const second = refOf(tasks[2]);
    expect(second).toEqual({ index: 2, text: 'milk', nth: 1 });
    expect(resolveTask(tasks, second).line).toBe(2);
    // A task added above shifts every index; the second "milk" is still the second.
    expect(resolveTask(parseTasks(`- [ ] bread\n${src}`), second).line).toBe(3);
    // The first "milk" deleted: no second occurrence left, so the nearest one is used.
    expect(resolveTask(parseTasks('- [ ] eggs\n- [ ] milk'), second).line).toBe(1);
    expect(toggleChecked(src, second)).toBe('- [ ] milk\n- [ ] eggs\n- [x] milk');
  });

  it('deletes a task with its sub-tasks', () => {
    const tasks = parseTasks(NOTE);
    expect(texts(deleteTask(NOTE, refOf(tasks[2])))).toEqual([' Finish API integration', ' Review pull request', ' Prepare deployment notes']);
  });

  it('moves a task (with its sub-tasks) before another, or to the end', () => {
    const tasks = parseTasks(NOTE);
    expect(texts(moveTask(NOTE, refOf(tasks[2]), 0))).toEqual(['x Fix login issue', ' Write regression test', ' Finish API integration', ' Review pull request', ' Prepare deployment notes']);
    expect(texts(moveTask(NOTE, refOf(tasks[0]), 99))).toEqual([' Review pull request', 'x Fix login issue', ' Write regression test', ' Prepare deployment notes', ' Finish API integration']);
    expect(moveTask(NOTE, refOf(tasks[0]), 1)).toBe(NOTE); // already there
    expect(moveTask(NOTE, refOf(tasks[2]), 3)).toBe(NOTE); // into its own sub-tasks
  });

  it('adds tasks in the list’s style, after the last one', () => {
    expect(addTask('', 'First')).toBe('- [ ] First\n');
    expect(addTask('Some intro.', 'First')).toBe('Some intro.\n\n- [ ] First\n');
    expect(addTask(NOTE, 'Deploy', { due: '2026-11-04', priority: 3 }).split('\n').pop()).toBe('- [ ] Deploy !!! 📅 2026-11-04');
    expect(addTask('1. [ ] one\n2. [ ] two\n\nAfter.', 'three')).toBe('1. [ ] one\n2. [ ] two\n3. [ ] three\n\nAfter.');
    expect(addTask('* [ ] a\n  * [ ] nested', 'b')).toBe('* [ ] a\n  * [ ] nested\n* [ ] b');
  });

  it('clears completed tasks only', () => {
    expect(texts(clearCompleted(NOTE))).toEqual([' Finish API integration', ' Review pull request', ' Write regression test', ' Prepare deployment notes']);
    expect(clearCompleted('- [ ] open')).toBe('- [ ] open');
  });

  it('reports progress', () => {
    expect(taskProgress(NOTE)).toEqual({ done: 1, total: 5 });
    expect(progressLabel({ done: 1, total: 5 })).toBe('1 of 5 completed');
    expect(progressLabel({ done: 2, total: 2 })).toBe('All tasks completed');
    expect(progressLabel({ done: 0, total: 0 })).toBe('No tasks');
  });
});

describe('dates', () => {
  it('uses local calendar days', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('buckets and labels due dates', () => {
    const today = '2026-11-02';
    expect(dueState('2026-11-01', today)).toBe('overdue');
    expect(dueState('2026-11-02', today)).toBe('today');
    expect(dueState('2026-11-09', today)).toBe('upcoming');
    expect(dueState(null, today)).toBe(null);
    expect(dueLabel('2026-11-02', today)).toBe('Today');
    expect(dueLabel('2026-11-03', today)).toBe('Tomorrow');
    expect(dueLabel('2026-11-01', today)).toBe('Yesterday');
  });
});

describe('parseTags', () => {
  it('finds hashtags outside headings, code and links', () => {
    const src = '# Heading\nPlan #Work and #home-lab.\n`#notatag`\n```\n#code\n```\n[x](https://a.dev/#frag) (#paren)';
    expect(parseTags(src)).toEqual(['work', 'home-lab', 'paren']);
  });
});

describe('checklistSegments', () => {
  it('keeps text and task runs in order, one list across blank lines', () => {
    const src = 'Intro line.\n\n- [ ] a\n\n- [x] b\n  continuation under b\n\n## Later\n\n- [ ] c\n```\n- [ ] code\n```';
    const segs = checklistSegments(src);
    expect(segs.map((s) => (s.type === 'md' ? `md:${s.text.trim()}` : `tasks:${s.tasks.map((t) => t.text).join(',')}`))).toEqual([
      'md:Intro line.',
      'tasks:a,b',
      'md:## Later',
      'tasks:c',
      'md:```\n- [ ] code\n```',
    ]);
  });

  it('checks a box without touching the rest of the line', () => {
    const src = '-   [ ]   spaced   text  !!  📅 2026-01-01';
    expect(toggleChecked(src, { index: 0 })).toBe('-   [x]   spaced   text  !!  📅 2026-01-01');
  });
});

