// Batch import of local image files into `background_images`.
// Each file is validated, decode-checked, hashed (sha256) for de-duplication and
// thumbnailed; a failure in one file never aborts the batch.

import { ACCEPTED_LOCAL_TYPES, decodeImage, makeThumbnail, sha256Hex } from './imageLoader.js';
import { addLocalRecord, findLocalByHash, isQuotaExceededError } from './repository.js';
import { broadcast } from './sync.js';

export const MAX_LOCAL_FILE_BYTES = 25 * 1024 * 1024;
const MAX_CONCURRENCY = 8;

// Some platforms report an empty MIME type; fall back to the extension.
const EXTENSION_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
};

class ImportFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ImportFailure';
    this.code = code;
  }
}

function fileName(file, index) {
  return typeof file?.name === 'string' && file.name ? file.name : `File ${index + 1}`;
}

function resolveType(file) {
  if (typeof file.type === 'string' && file.type) return file.type.toLowerCase();
  const name = typeof file.name === 'string' ? file.name : '';
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return EXTENSION_TYPES[ext] ?? '';
}

function validateFile(file) {
  if (!(file instanceof Blob)) throw new ImportFailure('NOT_A_FILE', 'Not a file');
  if (file.size === 0) throw new ImportFailure('EMPTY', 'The file is empty');
  const type = resolveType(file);
  if (!ACCEPTED_LOCAL_TYPES.includes(type)) {
    throw new ImportFailure('UNSUPPORTED_TYPE', 'Unsupported file type (use JPEG, PNG or GIF)');
  }
  if (file.size > MAX_LOCAL_FILE_BYTES) {
    throw new ImportFailure('TOO_LARGE', 'The file is larger than 25 MB');
  }
  return type;
}

/**
 * Default decode check: createImageBitmap when available, otherwise an <img>
 * decode through imageLoader.decodeImage on a temporary object URL.
 */
export async function verifyDecodable(blob) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    const ok = bitmap.width > 0 && bitmap.height > 0;
    if (typeof bitmap.close === 'function') bitmap.close();
    if (!ok) throw new Error('Image has no pixels');
    return;
  }
  const url = URL.createObjectURL(blob);
  try {
    await decodeImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function clampConcurrency(value, total) {
  const n = Number.isFinite(value) ? Math.floor(value) : 3;
  return Math.max(1, Math.min(n, MAX_CONCURRENCY, Math.max(total, 1)));
}

/**
 * importLocalFiles(files, { onProgress, signal, concurrency = 3 })
 *   -> { imported: number[], duplicates: string[], failed: [{ name, reason, code }], cancelled }
 *
 * `decodeCheck` (optional) replaces the default decode check, e.g. in tests.
 */
export async function importLocalFiles(files, {
  onProgress,
  signal,
  concurrency = 3,
  decodeCheck = verifyDecodable,
} = {}) {
  const list = files ? Array.from(files) : [];
  const total = list.length;
  const outcomes = new Array(total).fill(null);
  // hash -> Promise<outcome> of the first file in this batch with those bytes
  const batchHashes = new Map();
  let nextIndex = 0;
  let done = 0;

  const report = (current) => {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress({ done, total, current });
    } catch (err) {
      console.error('[wallpaper import] onProgress failed:', err);
    }
  };

  function toFailure(name, err) {
    if (err instanceof ImportFailure) {
      return { kind: 'failed', name, code: err.code, reason: err.message };
    }
    if (isQuotaExceededError(err)) {
      return { kind: 'failed', name, code: 'STORAGE_FULL', reason: 'Browser storage is full' };
    }
    return {
      kind: 'failed',
      name,
      code: 'ERROR',
      reason: err?.message ? String(err.message) : 'Import failed',
    };
  }

  // Everything after hashing and the in-batch duplicate check.
  async function storeFile(file, name, type, hash) {
    try {
      if (await findLocalByHash(hash) != null) return { kind: 'duplicate', name };

      try {
        await decodeCheck(file);
      } catch {
        throw new ImportFailure('INVALID_IMAGE', 'The image could not be read (corrupted or not an image)');
      }

      let thumb = null;
      try {
        thumb = await makeThumbnail(file);
      } catch {
        thumb = null;
      }

      // Do not write anything once the batch has been cancelled.
      if (signal?.aborted) return { kind: 'skipped', name };

      const id = await addLocalRecord({ blob: file, thumb, name, type, size: file.size, hash });
      return { kind: 'imported', name, id };
    } catch (err) {
      return toFailure(name, err);
    }
  }

  async function processFile(file, index) {
    const name = fileName(file, index);
    let type;
    let hash;
    try {
      type = validateFile(file);
      hash = await sha256Hex(file);
    } catch (err) {
      return toFailure(name, err);
    }

    // Same bytes as an earlier file in this batch: share that file's fate.
    // (The map is checked and filled synchronously, so concurrent workers cannot race.)
    const first = batchHashes.get(hash);
    if (first) {
      const outcome = await first;
      if (outcome.kind === 'imported' || outcome.kind === 'duplicate') return { kind: 'duplicate', name };
      return { ...outcome, name };
    }
    const pending = storeFile(file, name, type, hash);
    batchHashes.set(hash, pending);
    return pending;
  }

  async function worker() {
    while (nextIndex < total) {
      if (signal?.aborted) return;
      const index = nextIndex;
      nextIndex += 1;
      const outcome = await processFile(list[index], index);
      outcomes[index] = outcome;
      if (outcome.kind !== 'skipped') {
        done += 1;
        report(outcome.name);
      }
    }
  }

  report(null);
  const workers = [];
  for (let i = 0; i < clampConcurrency(concurrency, total); i += 1) workers.push(worker());
  await Promise.all(workers);

  const imported = [];
  const duplicates = [];
  const failed = [];
  for (const outcome of outcomes) {
    if (!outcome) continue;
    if (outcome.kind === 'imported') imported.push(outcome.id);
    else if (outcome.kind === 'duplicate') duplicates.push(outcome.name);
    else if (outcome.kind === 'failed') failed.push({ name: outcome.name, reason: outcome.reason, code: outcome.code });
  }

  const cancelled = Boolean(signal?.aborted) && outcomes.some((o) => !o || o.kind === 'skipped');
  if (imported.length > 0) broadcast('library-changed');
  return { imported, duplicates, failed, cancelled };
}
