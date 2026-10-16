// Prints the next release version for the release workflow as GitHub Actions outputs.
// Inputs (env): LATEST_TAG, LATEST_NAME (latest iWeb release), COMMIT_MESSAGES_FILE
// (pushed commit messages, separated by NUL), FALLBACK_VERSION (public/manifest.json).

import { appendFileSync, readFileSync } from 'node:fs';
import { nextVersion } from '../src/libs/updater/releaseVersion.js';

const messagesFile = process.env.COMMIT_MESSAGES_FILE;
const messages = messagesFile
  ? readFileSync(messagesFile, 'utf8').split('\0').map((m) => m.trim()).filter(Boolean)
  : [];

const result = nextVersion({
  latestTag: process.env.LATEST_TAG || '',
  latestName: process.env.LATEST_NAME || '',
  messages,
  fallback: process.env.FALLBACK_VERSION || '2.2',
});

console.log(`Next release: ${result.tag} (${result.kind} bump from "${process.env.LATEST_TAG || 'none'}")`);
const lines = [`version=${result.version}`, `tag=${result.tag}`, `manifest_version=${result.manifestVersion}`, `kind=${result.kind}`];
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
else console.log(lines.join('\n'));
