import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The CSS minifier (lightningcss) keeps only the last of `backdrop-filter` and
// `-webkit-backdrop-filter` when the unprefixed one comes first, and Chrome ignores the
// prefixed one: the blur vanished from the built extension. Prefixed first keeps both.

const SRC = fileURLToPath(new URL('../../', import.meta.url));

function cssFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

describe('backdrop-filter in CSS', () => {
  it('writes -webkit-backdrop-filter before backdrop-filter in every rule', () => {
    const wrong = [];
    for (const file of cssFiles(SRC)) {
      const css = readFileSync(file, 'utf8');
      for (const m of css.matchAll(/\{[^{}]*\}/g)) {
        const body = m[0];
        const plain = [...body.matchAll(/(?<![-\w])backdrop-filter\s*:/g)].map((x) => x.index);
        const prefixed = [...body.matchAll(/-webkit-backdrop-filter\s*:/g)].map((x) => x.index);
        if (plain.length && prefixed.length && Math.min(...plain) < Math.max(...prefixed)) {
          wrong.push(`${file.slice(SRC.length)}:${css.slice(0, m.index).split('\n').length}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});
