// Checklists in a note's Markdown: the single source of truth for Task Notes.
//
// A task is a GitHub-style checklist line, exactly as marked renders one:
//
//   - [ ] Review pull request !! 📅 2026-11-03
//   ^ bullet (-, *, +, 1. or 1)), optionally indented or inside a > quote
//
// Optional metadata sits at the end of the line, so the Markdown stays readable anywhere:
//   📅 YYYY-MM-DD   due date (a local calendar day, never converted to UTC)
//   ! / !! / !!!    priority low / medium / high (as in Apple Reminders)
//
// There is no separate task database. Every view (the checklist, Today, a desktop sticky)
// is parsed from the note's text, and every change rewrites only the task's own line.
// A task is addressed by a ref, { index, text, nth }: its position among the note's tasks,
// its text, and which occurrence of that text it is. If the note changed since the ref was
// taken, the nth task with that text is used instead (so duplicates keep their identity),
// and when no task has that text any more the change is skipped rather than applied to
// another line.

// quote prefix, indent, bullet, gap, mark, (whitespace + text). marked needs text after the
// box: "- [ ]" alone and "- [x]text" are plain list items, not tasks.
const TASK_LINE = /^((?:[ \t]*>[ \t]?)*)([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)\[([ xX])\][ \t]+(\S.*)$/;
const LIST_LINE = /^(?:[ \t]*>[ \t]?)*[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const FENCE = /^(?:[ \t]*>[ \t]?)*[ \t]{0,3}(`{3,}|~{3,})/;
const DUE_TOKEN = /^📅[ \t]*(\d{4}-\d{2}-\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const PRIORITIES = Object.freeze([
  { value: 0, label: 'None', marks: '' },
  { value: 1, label: 'Low', marks: '!' },
  { value: 2, label: 'Medium', marks: '!!' },
  { value: 3, label: 'High', marks: '!!!' },
]);

const width = (indent) => indent.replace(/\t/g, '    ').length;

/** Splits the trailing metadata tokens off a task's text. */
export function splitMeta(rest) {
  let text = rest.trimEnd();
  let due = null;
  let priority = 0;
  // Peel tokens off the end, at most one of each, in any order.
  for (let guard = 0; guard < 2; guard++) {
    const dueMatch = /(?:^|[ \t])(📅[ \t]*\d{4}-\d{2}-\d{2})$/.exec(text);
    if (!due && dueMatch && DUE_TOKEN.test(dueMatch[1])) {
      due = DUE_TOKEN.exec(dueMatch[1])[1];
      text = text.slice(0, text.length - dueMatch[1].length).trimEnd();
      continue;
    }
    const bang = /(?:^|[ \t])(!{1,3})$/.exec(text);
    if (!priority && bang && text.length > bang[1].length) {
      priority = bang[1].length;
      text = text.slice(0, text.length - bang[1].length).trimEnd();
      continue;
    }
    break;
  }
  return { text, due, priority };
}

/**
 * The note's tasks in document order:
 *   { index, line, quote, indent, depth, bullet, gap, checked, text, due, priority, nth }
 * (`nth`: how many earlier tasks have the same text).
 * Fenced and indented code blocks are skipped, as marked skips them.
 */
export function parseTasks(source) {
  const lines = (source || '').split('\n');
  const tasks = [];
  let fence = null;
  let inList = false;
  let prevBlank = true;
  const seen = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    const fenceMatch = FENCE.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }
    const blank = !line.trim();
    if (blank) {
      prevBlank = true;
      continue;
    }
    const lead = width(/^[ \t]*/.exec(line)[0]);
    // An indented code block: 4+ spaces after a blank line, outside a list.
    if (lead >= 4 && prevBlank && !inList) {
      prevBlank = false;
      continue;
    }
    const isList = LIST_LINE.test(line);
    if (isList) inList = true;
    else if (lead === 0) inList = false;
    prevBlank = false;
    const m = TASK_LINE.exec(line);
    if (!m) continue;
    const { text, due, priority } = splitMeta(m[6]);
    const nth = seen.get(text) || 0;
    seen.set(text, nth + 1);
    tasks.push({
      index: tasks.length,
      line: i,
      quote: m[1],
      indent: m[2],
      depth: Math.floor(width(m[2]) / 2),
      bullet: m[3],
      gap: m[4],
      checked: m[5] !== ' ',
      text,
      due,
      priority,
      nth,
    });
  }
  return tasks;
}

/** { done, total } for a note's checklist. */
export function taskProgress(source) {
  const tasks = parseTasks(source);
  return { done: tasks.filter((t) => t.checked).length, total: tasks.length };
}

export function progressLabel({ done, total }) {
  if (!total) return 'No tasks';
  if (done === total) return 'All tasks completed';
  return `${done} of ${total} completed`;
}

/** A task line from its parts (the inverse of parseTasks for one line). */
export function formatTask({ quote = '', indent = '', bullet = '-', gap = ' ', checked = false, text = '', due = null, priority = 0 }) {
  const marks = PRIORITIES[priority]?.marks || '';
  const meta = [marks, due ? `📅 ${due}` : ''].filter(Boolean).join(' ');
  const body = [text.trim() || 'New task', meta].filter(Boolean).join(' ');
  return `${quote}${indent}${bullet}${gap}[${checked ? 'x' : ' '}] ${body}`;
}

/** The task a ref points at in `tasks`, or null (see the note at the top). */
export function resolveTask(tasks, ref) {
  if (!ref) return null;
  const at = tasks[ref.index];
  if (at && (ref.text === undefined || at.text === ref.text)) return at;
  if (ref.text === undefined) return null;
  const same = tasks.filter((task) => task.text === ref.text);
  if (Number.isInteger(ref.nth) && same[ref.nth]) return same[ref.nth];
  let best = null;
  for (const task of same) {
    if (!best || Math.abs(task.index - ref.index) < Math.abs(best.index - ref.index)) best = task;
  }
  return best;
}

export const refOf = (task) => ({ index: task.index, text: task.text, nth: task.nth });

// Rewrites one task's line; returns the source unchanged when the ref no longer matches.
function rewrite(source, ref, change) {
  const tasks = parseTasks(source);
  const task = resolveTask(tasks, ref);
  if (!task) return source;
  const lines = source.split('\n');
  const cr = lines[task.line].endsWith('\r') ? '\r' : '';
  lines[task.line] = formatTask({ ...task, ...change(task) }) + cr;
  return lines.join('\n');
}

// Checking a box changes that one character and nothing else on the line.
function mark(source, ref, next) {
  const task = resolveTask(parseTasks(source), ref);
  if (!task) return source;
  const lines = source.split('\n');
  const at = task.quote.length + task.indent.length + task.bullet.length + task.gap.length + 1;
  const line = lines[task.line];
  const checked = next(task);
  if (checked === task.checked) return source;
  lines[task.line] = `${line.slice(0, at)}${checked ? 'x' : ' '}${line.slice(at + 1)}`;
  return lines.join('\n');
}

export const setChecked = (source, ref, checked) => mark(source, ref, () => Boolean(checked));
export const toggleChecked = (source, ref) => mark(source, ref, (t) => !t.checked);
export const setTaskText = (source, ref, text) => (text.trim() ? rewrite(source, ref, () => ({ text: text.trim() })) : source);
export const setDue = (source, ref, due) => rewrite(source, ref, () => ({ due: due && DATE_RE.test(due) ? due : null }));
export const setPriority = (source, ref, priority) => rewrite(source, ref, () => ({ priority: PRIORITIES[priority] ? priority : 0 }));

// The task's line plus the lines nested under it (its sub-tasks and continuation lines).
function blockOf(lines, task) {
  const own = width(task.indent);
  let end = task.line + 1;
  while (end < lines.length) {
    const line = lines[end].replace(/\r$/, '');
    if (!line.trim()) break;
    const body = line.slice(task.quote.length);
    if (width(/^[ \t]*/.exec(body)[0]) <= own) break;
    end++;
  }
  return { start: task.line, end };
}

/** Removes a task (and the lines nested under it). */
export function deleteTask(source, ref) {
  const task = resolveTask(parseTasks(source), ref);
  if (!task) return source;
  const lines = source.split('\n');
  const { start, end } = blockOf(lines, task);
  lines.splice(start, end - start);
  return lines.join('\n');
}

/**
 * Moves a task (with its nested lines) so it sits before the task now at `toIndex`, or
 * after the last task when `toIndex` is past the end. Indentation is kept as written.
 */
export function moveTask(source, ref, toIndex) {
  const tasks = parseTasks(source);
  const task = resolveTask(tasks, ref);
  if (!task) return source;
  const lines = source.split('\n');
  const { start, end } = blockOf(lines, task);
  if (toIndex === task.index || toIndex === task.index + 1) return source;
  const moved = lines.slice(start, end);
  let insertAt;
  if (toIndex >= tasks.length) {
    const last = tasks[tasks.length - 1];
    insertAt = blockOf(lines, last).end;
  } else {
    const target = tasks[Math.max(0, toIndex)];
    if (target.line >= start && target.line < end) return source; // into its own block
    insertAt = target.line;
  }
  if (insertAt > start && insertAt <= end) return source;
  const out = [...lines];
  out.splice(start, end - start);
  out.splice(insertAt > start ? insertAt - moved.length : insertAt, 0, ...moved);
  return out.join('\n');
}

/**
 * Adds an unchecked task after the note's last task, in that list's style (same quote,
 * indent and bullet; numbered lists count on), or at the end when the note has none.
 */
export function addTask(source, text, { due = null, priority = 0 } = {}) {
  const value = source || '';
  const tasks = parseTasks(value);
  const lines = value.split('\n');
  if (!tasks.length) {
    const line = formatTask({ text, due, priority });
    if (!value.trim()) return `${line}\n`;
    const trimmed = value.replace(/\s+$/, '');
    return `${trimmed}\n\n${line}\n`;
  }
  const last = tasks[tasks.length - 1];
  // Style from the last task at the outermost level (a new task isn't a sub-task).
  const peers = tasks.filter((t) => t.quote === last.quote);
  const top = Math.min(...peers.map((t) => t.depth));
  const anchor = peers.filter((t) => t.depth === top).pop();
  const numbered = /^\d+/.exec(anchor.bullet);
  const bullet = numbered ? `${Number(numbered[0]) + 1}${anchor.bullet.slice(numbered[0].length)}` : anchor.bullet;
  const { end } = blockOf(lines, last);
  lines.splice(end, 0, formatTask({ quote: anchor.quote, indent: anchor.indent, bullet, gap: anchor.gap, text, due, priority }));
  return lines.join('\n');
}

/** Removes every completed task line (unchecked sub-tasks under them stay). */
export function clearCompleted(source) {
  const tasks = parseTasks(source).filter((t) => t.checked);
  if (!tasks.length) return source;
  const drop = new Set(tasks.map((t) => t.line));
  return source.split('\n').filter((_, i) => !drop.has(i)).join('\n');
}

// ---- Checklist view ----------------------------------------------------------------------

/**
 * The note split for the Checklist view: [{ type: 'md', text } | { type: 'tasks', tasks }],
 * in order. Blank lines between tasks keep one list; lines indented under a task (notes,
 * continuation text) belong to it and are only shown in Write.
 */
export function checklistSegments(content, tasks = parseTasks(content)) {
  const lines = content.split('\n');
  const byLine = new Map(tasks.map((t) => [t.line, t]));
  const out = [];
  let md = [];
  let block = null;
  const flush = () => {
    if (md.some((l) => l.trim())) out.push({ type: 'md', text: md.join('\n'), key: `md-${out.length}` });
    md = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const task = byLine.get(i);
    if (task) {
      flush();
      if (!block) {
        block = { type: 'tasks', tasks: [], key: `tasks-${out.length}` };
        out.push(block);
      }
      block.tasks.push(task);
      continue;
    }
    const line = lines[i];
    if (block) {
      if (!line.trim()) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (byLine.has(j)) continue; // blank lines between tasks: one list
      } else {
        const last = block.tasks[block.tasks.length - 1];
        // Continuation lines under a task belong to it (shown in Write).
        if (width(/^[ \t]*/.exec(line.slice(last.quote.length))[0]) > width(last.indent)) continue;
      }
      block = null;
    }
    md.push(line);
  }
  flush();
  return out;
}

// ---- Dates ---------------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');

/** A local calendar day as YYYY-MM-DD (no UTC conversion). */
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The day `n` days after `key` (local calendar arithmetic). */
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n));
}

/** 'overdue' | 'today' | 'upcoming' | null for an open task's due date. */
export function dueState(due, today = dayKey()) {
  if (!due) return null;
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  return 'upcoming';
}

/** "Today", "Tomorrow", "Yesterday", a weekday this week, else a short date. */
export function dueLabel(due, today = dayKey()) {
  if (!due) return '';
  if (due === today) return 'Today';
  if (due === addDays(today, 1)) return 'Tomorrow';
  if (due === addDays(today, -1)) return 'Yesterday';
  const [y, m, d] = due.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (due > today && due <= addDays(today, 6)) return date.toLocaleDateString(undefined, { weekday: 'long' });
  const sameYear = y === Number(today.slice(0, 4));
  return date.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---- Tags ----------------------------------------------------------------------------------

const TAG_RE = /(^|[\s(])#([A-Za-z][\w-]{0,39})(?=$|[\s.,;:!?)])/g;

/** Hashtags in a note (#work), lower-cased, outside code; headings ("# Title") aren't tags. */
export function parseTags(source) {
  const tags = new Set();
  let fence = null;
  for (const raw of (source || '').split('\n')) {
    const fenceMatch = FENCE.exec(raw);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }
    const line = raw.replace(/`[^`]*`/g, ' ').replace(/\]\([^)]*\)/g, ']');
    for (const m of line.matchAll(TAG_RE)) tags.add(m[2].toLowerCase());
  }
  return [...tags];
}
