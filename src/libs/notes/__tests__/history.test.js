import { describe, expect, it } from 'vitest';
import { GROUP_MS, MAX_STEPS, canRedo, canUndo, createHistory, record, redo, undo } from '../history';

const at = (value) => ({ value, start: value.length, end: value.length });

describe('note history', () => {
  it('groups fast typing into one step and splits it after a pause', () => {
    let h = createHistory('');
    h = record(h, at('h'), { kind: 'insert', now: 0 });
    h = record(h, at('hi'), { kind: 'insert', now: 200 });
    h = record(h, at('hi!'), { kind: 'insert', now: 400 });
    h = record(h, at('hi! there'), { kind: 'insert', now: 400 + GROUP_MS + 1 });
    expect(h.present.value).toBe('hi! there');
    h = undo(h);
    expect(h.present.value).toBe('hi!');
    h = undo(h);
    expect(h.present.value).toBe('');
    expect(canUndo(h)).toBe(false);
  });

  it('starts a new step when typing switches between adding and deleting', () => {
    let h = createHistory('');
    h = record(h, at('abc'), { kind: 'insert', now: 0 });
    h = record(h, at('ab'), { kind: 'delete', now: 100 });
    expect(undo(h).present.value).toBe('abc');
  });

  it('keeps toolbar edits and checklist ticks as their own steps', () => {
    let h = createHistory('milk');
    h = record(h, at('**milk**'), { kind: 'format', now: 0 });
    h = record(h, at('- [ ] **milk**'), { kind: 'format', now: 10 });
    expect(undo(h).present.value).toBe('**milk**');
  });

  it('redoes what was undone, and a new edit clears the redo steps', () => {
    let h = createHistory('a');
    h = record(h, at('ab'), { kind: 'format', now: 0 });
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    expect(redo(h).present.value).toBe('ab');
    h = record(h, at('ax'), { kind: 'format', now: 50 });
    expect(canRedo(h)).toBe(false);
  });

  it('restores the selection with the text', () => {
    let h = createHistory('hello', 0, 5);
    h = record(h, { value: '**hello**', start: 2, end: 7 }, { kind: 'format' });
    expect(undo(h).present).toEqual({ value: 'hello', start: 0, end: 5 });
  });

  it('undo returns to the selection a toolbar edit was applied to', () => {
    let h = createHistory('');
    h = record(h, at('milk and eggs'), { kind: 'insert', now: 0 });
    h = record(h, { value: 'milk and **eggs**', start: 11, end: 15 }, { kind: 'format', now: 5000, before: { start: 9, end: 13 } });
    expect(undo(h).present).toEqual({ value: 'milk and eggs', start: 9, end: 13 });
  });

  it('ignores no-op changes and caps the number of steps', () => {
    let h = createHistory('x');
    h = record(h, at('x'), { kind: 'format' });
    expect(canUndo(h)).toBe(false);
    for (let i = 0; i < MAX_STEPS + 20; i++) h = record(h, at(`x${i}`), { kind: 'format' });
    expect(h.past.length).toBe(MAX_STEPS);
  });
});
