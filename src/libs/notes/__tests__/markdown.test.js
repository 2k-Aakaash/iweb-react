import { describe, expect, it } from 'vitest';
import { applyFormat, markdownToText, toggleTask } from '../markdown';

// Rendering + sanitizing (DOMPurify) need a DOM and are checked in the browser; these cover
// the pure text helpers.

describe('toggleTask', () => {
  const src = '# List\n- [ ] milk\n- [x] eggs\n  * [ ] nested\n1. [ ] numbered';

  it('flips the n-th checklist item only', () => {
    expect(toggleTask(src, 0)).toContain('- [x] milk');
    expect(toggleTask(src, 1)).toContain('- [ ] eggs');
    expect(toggleTask(src, 2)).toContain('  * [x] nested');
    expect(toggleTask(src, 3)).toContain('1. [x] numbered');
    expect(toggleTask(src, 0).split('\n').filter((l, i) => l !== src.split('\n')[i])).toHaveLength(1);
  });

  it('leaves the text alone for an out-of-range index', () => {
    expect(toggleTask(src, 9)).toBe(src);
  });
});

describe('markdownToText', () => {
  it('strips syntax for snippets and word counts', () => {
    const md = '## Plan\n- [ ] **buy** _milk_\n> quote\n[iWeb](https://x.dev) and `code`\n\n```js\nlet x\n```\n---';
    expect(markdownToText(md)).toBe('Plan buy milk quote iWeb and code');
  });

  it('handles empty input', () => {
    expect(markdownToText('')).toBe('');
    expect(markdownToText(undefined)).toBe('');
  });
});

describe('applyFormat', () => {
  it('wraps the selection in bold and selects the text', () => {
    const r = applyFormat('say hello', 4, 9, 'bold');
    expect(r.value).toBe('say **hello**');
    expect(r.value.slice(r.start, r.end)).toBe('hello');
  });

  it('removes bold when the selection is already wrapped', () => {
    const r = applyFormat('say **hello**', 6, 11, 'bold');
    expect(r.value).toBe('say hello');
    expect(r.value.slice(r.start, r.end)).toBe('hello');
  });

  it('inserts a placeholder when nothing is selected', () => {
    const r = applyFormat('x ', 2, 2, 'italic');
    expect(r.value).toBe('x _italic text_');
    expect(r.value.slice(r.start, r.end)).toBe('italic text');
  });

  it('prefixes every selected line, and toggles it off again', () => {
    const on = applyFormat('one\ntwo', 0, 7, 'task');
    expect(on.value).toBe('- [ ] one\n- [ ] two');
    expect(applyFormat(on.value, 0, on.value.length, 'task').value).toBe('one\ntwo');
  });

  it('turns the selection into a link with the URL selected', () => {
    const r = applyFormat('see docs', 4, 8, 'link');
    expect(r.value).toBe('see [docs](https://)');
    expect(r.value.slice(r.start, r.end)).toBe('https://');
  });

  it('wraps a code block on its own lines', () => {
    const r = applyFormat('a\nlet x = 1', 2, 11, 'codeblock');
    expect(r.value).toBe('a\n```\nlet x = 1\n```\n');
    expect(r.value.slice(r.start, r.end)).toBe('let x = 1');
  });
});
