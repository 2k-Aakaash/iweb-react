// Markdown for Notes: rendering the Preview, a plain-text snippet for the list, checklist
// toggling from the Preview, and the formatting toolbar's text edits.
//
// Rendering is marked (GitHub-flavoured: tables, checklists, strikethrough, line breaks as
// typed) and the HTML is always passed through DOMPurify, since notes can hold pasted text.

import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

let hooked = false;

const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Safe HTML for the Preview. Checklist boxes carry data-task="<index>" so they can be toggled. */
export function renderMarkdown(source) {
  // DOMPurify needs a DOM. Without one, never return unsanitized HTML: show plain text.
  if (!DOMPurify.isSupported) return `<pre>${escapeHtml(source || '')}</pre>`;
  if (!hooked) {
    // Links open in a new tab and never get access to iWeb's page.
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A' && node.getAttribute('href')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
    hooked = true;
  }
  const html = marked.parse(source || '');
  const clean = DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
  let index = 0;
  return clean.replace(/<input([^>]*?)type="checkbox"([^>]*)>/g, (_, a, b) => {
    const attrs = `${a}${b}`.replace(/\sdisabled(="")?/g, '');
    return `<input${attrs} type="checkbox" data-task="${index++}">`;
  });
}

const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\])/gm;

/** Flips the n-th checklist item ("- [ ]" <-> "- [x]") in the Markdown source. */
export function toggleTask(source, n) {
  let i = 0;
  return source.replace(TASK_RE, (match, open, mark, close) => {
    if (i++ !== n) return match;
    return `${open}${mark === ' ' ? 'x' : ' '}${close}`;
  });
}

/** Plain text of a Markdown note (for list snippets and word counts). */
export function markdownToText(source) {
  return (source || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]\s+\[[ xX]\]|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([^*_~]+?)\1/g, '$2')
    .replace(/^\s*([-*_]\s*){3,}$/gm, ' ')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Toolbar edits on a textarea's value. Returns { value, start, end } with the new selection.
 *   wrap  — surround the selection (bold, italic, code, strike), or insert a placeholder.
 *   line  — prefix every selected line (heading, list, checklist, quote).
 *   link  — [text](url)
 *   block — fenced code block around the selection.
 */
export const FORMATS = {
  bold: { kind: 'wrap', before: '**', after: '**', placeholder: 'bold text' },
  italic: { kind: 'wrap', before: '_', after: '_', placeholder: 'italic text' },
  strike: { kind: 'wrap', before: '~~', after: '~~', placeholder: 'struck text' },
  code: { kind: 'wrap', before: '`', after: '`', placeholder: 'code' },
  heading: { kind: 'line', prefix: '## ' },
  bullet: { kind: 'line', prefix: '- ' },
  number: { kind: 'line', prefix: '1. ' },
  task: { kind: 'line', prefix: '- [ ] ' },
  quote: { kind: 'line', prefix: '> ' },
  link: { kind: 'link' },
  codeblock: { kind: 'block' },
};

export function applyFormat(value, start, end, name) {
  const format = FORMATS[name];
  const selected = value.slice(start, end);
  const head = value.slice(0, start);
  const tail = value.slice(end);

  if (format.kind === 'wrap') {
    const text = selected || format.placeholder;
    // Toggle off when the selection is already wrapped.
    if (head.endsWith(format.before) && tail.startsWith(format.after)) {
      const v = head.slice(0, -format.before.length) + selected + tail.slice(format.after.length);
      return { value: v, start: start - format.before.length, end: end - format.before.length };
    }
    const v = head + format.before + text + format.after + tail;
    const s = start + format.before.length;
    return { value: v, start: s, end: s + text.length };
  }

  if (format.kind === 'line') {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const block = value.slice(lineStart, end);
    const lines = block.split('\n');
    const allPrefixed = lines.every((l) => l.startsWith(format.prefix));
    const next = lines.map((l) => (allPrefixed ? l.slice(format.prefix.length) : format.prefix + l)).join('\n');
    const v = value.slice(0, lineStart) + next + value.slice(end);
    const delta = next.length - block.length;
    return { value: v, start: Math.max(lineStart, start + (allPrefixed ? -format.prefix.length : format.prefix.length)), end: end + delta };
  }

  if (format.kind === 'link') {
    const text = selected || 'link text';
    const v = `${head}[${text}](https://)${tail}`;
    const urlStart = start + text.length + 3;
    return { value: v, start: urlStart, end: urlStart + 'https://'.length };
  }

  // block
  const text = selected || 'code';
  const needsNewline = head && !head.endsWith('\n') ? '\n' : '';
  const v = `${head}${needsNewline}\`\`\`\n${text}\n\`\`\`\n${tail}`;
  const s = start + needsNewline.length + 4;
  return { value: v, start: s, end: s + text.length };
}
