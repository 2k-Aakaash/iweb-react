// Makes a theme's skin.css safe to put on the page. A theme is data: its CSS may style iWeb,
// but not load anything from outside the package or run anything. Parsed with PostCSS (not
// patterns), then:
//
//   at-rules   only @media, @supports, @container, @layer, @font-face, @keyframes and
//              @property stay; @import (outside files), @namespace and the rest are dropped
//   url()      a file in the package becomes url("iwtheme:<path>") (made a real URL when the
//              theme is applied); a #fragment (an SVG filter on the page) and small data:
//              images stay; anything else (another site, a missing file) drops the declaration
//   values     expression(), javascript:, behavior, -moz-binding, image-set() with bare
//              strings (it loads them like url()) and CSS escapes outside strings drop the
//              declaration
//
// Returns { css, removed } where `removed` lists what was dropped, for the author.
import postcss from 'postcss';
import { cleanPath } from './paths.js';

const AT_RULES = new Set(['media', 'supports', 'container', 'layer', 'font-face', 'keyframes', '-webkit-keyframes', 'property']);
const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp|avif|svg\+xml)[;,]/i;
const DANGEROUS = /expression\s*\(|javascript:|vbscript:|-moz-binding|(^|[^-\w])behavior\s*:/i;
const URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s]*))\s*\)/gi;
const MAX_DATA_URL = 64 * 1024;

export function sanitizeCss(source, { hasFile = () => false } = {}) {
  const removed = [];
  let root;
  try {
    root = postcss.parse(source);
  } catch (err) {
    return { css: '', removed: [`skin.css could not be read (${err.reason || err.message}).`] };
  }

  root.walkAtRules((rule) => {
    if (!AT_RULES.has(rule.name.toLowerCase())) {
      removed.push(`@${rule.name}`);
      rule.remove();
    }
  });

  root.walkDecls((decl) => {
    const where = `${decl.prop}: ${decl.value.slice(0, 60)}`;
    // A CSS escape outside a string can spell anything (`\75 rl(` is `url(`): not allowed.
    const unquoted = decl.value.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
    if (decl.prop.includes('\\') || unquoted.includes('\\') || DANGEROUS.test(`${decl.prop}:${decl.value}`)) {
      removed.push(where);
      decl.remove();
      return;
    }
    if (/image-set\s*\(/i.test(decl.value) && /image-set\s*\([^)]*["']/i.test(decl.value.replace(URL, ''))) {
      removed.push(where);
      decl.remove();
      return;
    }
    let bad = false;
    const value = decl.value.replace(URL, (whole, dq, sq, bare) => {
      const target = (dq ?? sq ?? bare ?? '').trim();
      if (target.startsWith('#') && /^#[\w-]+$/.test(target)) return whole; // an element on the page
      if (DATA_IMAGE.test(target) && target.length <= MAX_DATA_URL) return `url("${target.replace(/"/g, '%22')}")`;
      const path = /^[a-z][a-z0-9+.-]*:/i.test(target) ? null : cleanPath(target);
      if (path && hasFile(path)) return `url("iwtheme:${path}")`;
      bad = true;
      return whole;
    });
    if (bad) {
      removed.push(where);
      decl.remove();
    } else {
      decl.value = value;
    }
  });

  // Comments carry nothing a page needs.
  root.walkComments((c) => c.remove());
  return { css: root.toString(), removed };
}
