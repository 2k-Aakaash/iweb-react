// One-time thumbnail backfill for wallpapers stored before thumbnails existed.
// Without a thumbnail the gallery would have to decode the full-resolution image
// (and animate full-size GIFs) for every card, which makes scrolling expensive.

import { makeThumbnail } from './imageLoader.js';
import { getWallpaperRecord, listMissingThumbnails, setThumbnail } from './repository.js';
import { broadcast } from './sync.js';

export const GALLERY_THUMB_EDGE = 320;

let running = null;

/**
 * Generates and stores missing thumbnails one at a time (bounded memory/CPU).
 * Concurrent callers share the same run. Resolves to the number of thumbnails created.
 */
export function backfillThumbnails() {
  if (running) return running;
  running = (async () => {
    let created = 0;
    try {
      const refs = await listMissingThumbnails();
      for (const ref of refs) {
        try {
          const record = await getWallpaperRecord(ref);
          if (!record?.blob || record.thumb) continue;
          const thumb = await makeThumbnail(record.blob, GALLERY_THUMB_EDGE);
          if (thumb && (await setThumbnail(ref, thumb))) created += 1;
        } catch (err) {
          console.warn('[wallpaper] thumbnail backfill skipped a record:', err);
        }
      }
    } finally {
      running = null;
    }
    if (created > 0) broadcast('library-changed');
    return created;
  })();
  return running;
}
