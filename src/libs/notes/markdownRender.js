// Rendering a note's Preview: marked (GitHub-flavoured: tables, checklists, strikethrough,
// line breaks as typed), with the HTML always passed through DOMPurify, since notes can hold
// pasted text. Loaded by Notes the first time a Preview is shown.

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
