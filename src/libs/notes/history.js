// Undo / redo history for a note's text.
//
// The browser's own textarea undo breaks as soon as the value is changed from code (toolbar
// formatting, ticking a checklist in the Preview, switching notes), so Notes keeps its own.
// Each entry is { value, start, end } (the text and the selection to restore).
//
// Typing is grouped: keystrokes within GROUP_MS of each other form one undo step, and a new
// step starts after a pause or when typing switches between adding and deleting. Toolbar edits
// and checklist ticks are always their own step.

export const GROUP_MS = 1000;
export const MAX_STEPS = 200;

export function createHistory(value = '', start = 0, end = start) {
  return { past: [], present: { value, start, end }, future: [], lastKind: null, lastAt: 0 };
}

/**
 * Records a change. `kind` is 'insert' / 'delete' for typing (grouped) or anything else
 * (e.g. 'format', 'task') for a standalone step. `before` (optional { start, end }) is the
 * selection just before the change (e.g. the text a toolbar button was applied to), so undo
 * returns to exactly that selection. Returns the new history.
 */
export function record(history, entry, { kind = 'edit', now = Date.now(), before } = {}) {
  if (before) history = { ...history, present: { ...history.present, start: before.start, end: before.end } };
  if (entry.value === history.present.value) {
    return { ...history, present: { ...history.present, start: entry.start, end: entry.end } };
  }
  const typing = kind === 'insert' || kind === 'delete';
  const group = typing && history.lastKind === kind && now - history.lastAt < GROUP_MS && history.past.length > 0;
  if (group) {
    // Extend the current typing step: keep the state before it, replace the present.
    return { ...history, present: entry, future: [], lastAt: now };
  }
  const past = [...history.past, history.present].slice(-MAX_STEPS);
  return { past, present: entry, future: [], lastKind: kind, lastAt: now };
}

export const canUndo = (history) => history.past.length > 0;
export const canRedo = (history) => history.future.length > 0;

export function undo(history) {
  if (!canUndo(history)) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
    lastKind: null,
    lastAt: 0,
  };
}

export function redo(history) {
  if (!canRedo(history)) return history;
  const [next, ...rest] = history.future;
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
    lastKind: null,
    lastAt: 0,
  };
}

/** 'insert' or 'delete' for a typed change from `before` to `after` text. */
export const typingKind = (before, after) => (after.length < before.length ? 'delete' : 'insert');
