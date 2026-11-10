// Writes a release's description (Markdown) for the release workflow.
//
//   node scripts/release-notes.mjs <tag> [kind]
//
// The text comes from docs/releases/<tag>.md when it exists; otherwise it lists the pushed
// commits' subjects (COMMIT_MESSAGES_FILE, NUL-separated). An install note and a link to
// the source commit are added at the end. The source commit is SOURCE_SHA / SOURCE_URL, or,
// when editing an earlier release, the one linked in its current description
// (EXISTING_BODY_FILE), so it's kept.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NOTES_DIR = new URL('../docs/releases/', import.meta.url);
const SOURCE_LINK = /\[iweb-react@([0-9a-f]{7,40})\]\((https:\/\/[^)\s]+)\)/;

const INSTALL = [
  '**Install:** download **iWeb.Extension.zip**, unzip it, open `chrome://extensions`, turn on',
  'Developer mode, choose **Load unpacked** and select the unzipped folder. Already using iWeb?',
  'Settings → About → Software Update installs it for you.',
].join(' ');

/** "feat: Notes + Daily Tasks" → "Notes + Daily Tasks" (first line only). */
export function commitSubject(message) {
  const first = String(message).split('\n')[0].trim();
  return first.replace(/^(feat|fix|chore|perf|refactor|docs|style|build|ci|test)(\([^)]*\))?!?:\s*/i, '').replace(/\s*\[major\]\s*/i, ' ').trim();
}

/** The release description: its notes (or the commits), then install and source. */
export function composeNotes({ tag, kind = '', notes = null, messages = [], source = null }) {
  let body = notes?.trim();
  if (!body) {
    const subjects = messages.map(commitSubject).filter((s) => s && !/^merge /i.test(s));
    const label = kind ? `${kind[0].toUpperCase()}${kind.slice(1)} release` : 'Release';
    body = [`# iWeb ${tag}`, '', `${label}.`, '', '## Changes', ...(subjects.length ? subjects.map((s) => `- ${s}`) : ['- Maintenance and stability improvements.'])].join('\n');
  }
  const footer = ['---', INSTALL];
  if (source) footer.push('', `<sub>Automated build of [iweb-react@${source.sha.slice(0, 7)}](${source.url}).</sub>`);
  return `${body}\n\n${footer.join('\n')}\n`;
}

/** The source commit linked in an existing description, if any. */
export function sourceFromBody(body) {
  const m = SOURCE_LINK.exec(body || '');
  return m ? { sha: m[1], url: m[2] } : null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [tag, kind = ''] = process.argv.slice(2);
  if (!tag) {
    console.error('usage: node scripts/release-notes.mjs <tag> [kind]');
    process.exit(1);
  }
  const file = new URL(`${tag}.md`, NOTES_DIR);
  const notes = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const { COMMIT_MESSAGES_FILE, SOURCE_SHA, SOURCE_URL, EXISTING_BODY_FILE } = process.env;
  const messages = COMMIT_MESSAGES_FILE && existsSync(COMMIT_MESSAGES_FILE)
    ? readFileSync(COMMIT_MESSAGES_FILE, 'utf8').split('\0').map((m) => m.trim()).filter(Boolean)
    : [];
  const source = SOURCE_SHA && SOURCE_URL
    ? { sha: SOURCE_SHA, url: SOURCE_URL }
    : sourceFromBody(EXISTING_BODY_FILE && existsSync(EXISTING_BODY_FILE) ? readFileSync(EXISTING_BODY_FILE, 'utf8') : '');
  process.stdout.write(composeNotes({ tag, kind, notes, messages, source }));
}
