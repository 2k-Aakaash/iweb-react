# Wallpaper system (`src/libs/wallpaper/`)

Plain JavaScript ES modules, no new runtime dependencies. All IndexedDB access goes through `db.js` → `openIwebDB()` (iWebDB **v3**).
Network code never lives in components. Components never touch IndexedDB directly.

## Data model

| Store | Key | Record |
|---|---|---|
| `background_images` (existing) | `id` autoInc | `{ id, blob, thumb?, name?, type?, size?, hash?, createdAt? }` — v2 records only have `{id, blob}`; every v3 field is optional |
| `unsplash_images` | `photoId` | see `UnsplashRecord` below |
| `wallpaper_meta` | `key` | `{ key: 'unsplash_quota', date, acquisitions: [{requestId, photoId, at}], reservations: [{requestId, at, expiresAt}] }` |

```
UnsplashRecord = {
  photoId, blob: Blob|null, thumb: Blob|null, size,
  width, height, color, description,
  urls: { raw, full, regular, small, thumb },          // hotlink URLs (Unsplash guideline: hotlink when online)
  photographer: { name, username, profileUrl },        // profileUrl already carries utm params
  photoPageUrl,                                        // utm params included
  downloadLocation,
  query, topic, keywords: string[],                    // lower-cased tokens of query/topic/description/tags → 'keywords' multiEntry index
  acquiredAt, lastUsedAt                               // ms epoch; lastUsedAt null = never displayed
}
WallpaperRef = { source: 'local' | 'unsplash', id }    // id: number (local) | string photoId (unsplash)
```

Local and Unsplash records live in separate stores, so a local `id` can never collide with an Unsplash `photoId`.

## Settings (localStorage — existing app convention; `storage` events give cross-tab sync)

- `wallpaperSettings` JSON: `{ source: 'local'|'unsplash', discoveryMode: 'topics'|'keyword'|'random', topics: string[], keyword: string }`
- `activeWallpaper` JSON `WallpaperRef`. When the source is local, `lastUsedBackgroundId` is also written (backup and legacy compatibility).

## Module contract (signatures are fixed; implement exactly)

### `settings.js`
- `DEFAULT_SETTINGS`
- `getWallpaperSettings() -> settings` (validated, merged with defaults)
- `setWallpaperSettings(patch) -> settings` (persists, broadcasts `settings-changed`)
- `getActiveWallpaper() -> WallpaperRef|null` (falls back to `lastUsedBackgroundId` → `{source:'local', id:Number}`)
- `setActiveWallpaper(ref|null)` (persists, broadcasts `active-changed`)

### `sync.js`
- `broadcast(type, payload?)`: BroadcastChannel `'iweb-wallpaper'`
- `subscribe(handler) -> unsubscribe`: handler receives `{ type, payload }` for BroadcastChannel messages from other tabs **and** for localStorage `storage` events on `wallpaperSettings`/`activeWallpaper` (mapped to `settings-changed` / `active-changed`)
- Types: `'active-changed' | 'library-changed' | 'quota-changed' | 'settings-changed'`. These are signals only; receivers re-read persistent state.
- `broadcast` ALSO notifies same-tab subscribers (synchronously, `{ type, payload, local: true }`). That is how the Settings UI tells `Background.jsx` to render: UI → `setActiveWallpaper(ref)` → `active-changed` → Background → `showWallpaper`. `Background.jsx` is the only caller of `showWallpaper`.

### `quotaLimiter.js`
- `DAILY_LIMIT = 3`, `RESERVATION_TTL_MS = 120000`
- `localDateKey(date = new Date()) -> 'YYYY-MM-DD'` (local calendar)
- `nextLocalMidnight(date = new Date()) -> Date`
- `getQuotaStatus({ now } = {}) -> { date, used, reserved, remaining, limit, resetsAt }`
- `reserveSlot({ requestId, now } = {}) -> { requestId }`. Throws `QuotaError` with `code: 'DAILY_LIMIT'`. Re-reserving the same requestId is idempotent.
- `commitSlot(requestId, photoId, { now } = {}) -> { counted: boolean }`. Idempotent. If `photoId` was already acquired today, the reservation is released instead (no double count).
- `releaseSlot(requestId) -> void`
- `class QuotaError extends Error { code }`
- Every operation is ONE readwrite transaction on `wallpaper_meta`: roll the date over → drop expired reservations → check `acquisitions + reservations < DAILY_LIMIT`. `now` is an injectable ms timestamp for tests. Broadcasts `quota-changed` after writes.

### `repository.js`
- `listLocal() -> [{ id, source:'local', thumb: Blob|null, blob: Blob, name, createdAt }]`
- `listUnsplash() -> UnsplashRecord[]` (newest `acquiredAt` first)
- `getWallpaperRecord(ref) -> record|null`
- `addLocalRecord({ blob, thumb, name, type, size, hash }) -> id`
- `findLocalByHash(hash) -> id|null`
- `putUnsplash(record)`, `getUnsplash(photoId)`, `touchWallpaper(ref)` (sets `lastUsedAt` on Unsplash records; no-op for local)
- `searchUnsplashCache(query) -> UnsplashRecord[]` (tokens matched through the `keywords` index)
- `deleteWallpapers(refs) -> { deleted: WallpaperRef[], missing: WallpaperRef[], newActive: WallpaperRef|null }`. If the active wallpaper is among `refs`, it picks a replacement from the remaining records (same source first) and calls `setActiveWallpaper` **before** deleting. Both stores are deleted in a single transaction. Broadcasts `library-changed`.
- `evictUnsplashCache({ maxCount = 40, maxBytes = 200 * 1024 * 1024, protect = [] } = {}) -> number evicted` (LRU by `lastUsedAt ?? acquiredAt`). Never evicts the active wallpaper or anything in `protect`. Never touches local images.
- `isQuotaExceededError(err) -> boolean`

### `imageLoader.js`
- `ACCEPTED_LOCAL_TYPES = ['image/jpeg', 'image/png', 'image/gif']` (the existing formats, unchanged)
- `pickUnsplashUrl(urls, { width = innerWidth, height = innerHeight, dpr = devicePixelRatio } = {}) -> string`: uses `urls.raw` with `w`, `q=80`, `fm=jpg`, `fit=max`. Width = viewport long edge × dpr, rounded up to a 320px step and capped at 3840.
- `fetchImageBlob(url, { signal, maxBytes = 25 * 1024 * 1024 } = {}) -> Blob`: validates `ok` status, `image/*` content type and size
- `decodeImage(src) -> Promise<HTMLImageElement>` (`img.decode()`; rejects on failure)
- `makeThumbnail(blob, maxEdge = 320) -> Promise<Blob|null>` (createImageBitmap + OffscreenCanvas or canvas, WebP→JPEG fallback; returns null where unsupported)
- `sha256Hex(blob) -> Promise<string>`

### `importManager.js`
- `importLocalFiles(files, { onProgress, signal, concurrency = 3 } = {}) -> { imported: number[], duplicates: string[], failed: [{ name, reason }], cancelled: boolean }`
- `onProgress({ done, total, current })`. Validates type and size (25 MB max); a decode check rejects corrupted files; deduplicates by sha256 hash; one failure never aborts the batch. Broadcasts `library-changed` once at the end.

### `unsplashClient.js`
- `isUnsplashConfigured() -> boolean` (reads `import.meta.env.VITE_UNSPLASH_ACCESS_KEY`)
- `getRandomPhotos({ query, count = 10, signal }) -> NormalizedPhoto[]` (`GET /photos/random`, orientation=landscape, content_filter=high)
- `searchPhotos({ query, page = 1, perPage = 24, signal }) -> { results: NormalizedPhoto[], total, totalPages }`
- `trackDownload(downloadLocation, { signal }) -> Promise<void>` (required by the guidelines when a photo is used as a wallpaper)
- `getApiRateInfo() -> { limit, remaining, updatedAt } | null` (from the `X-Ratelimit-*` headers)
- `withUtm(url) -> string`
- `class UnsplashError extends Error { code, status, retryAfter }`, with code one of `NOT_CONFIGURED | UNAUTHORIZED | RATE_LIMITED | NOT_FOUND | NETWORK | OFFLINE | BAD_RESPONSE | SERVER | ABORTED | INVALID_QUERY`
- `NormalizedPhoto = { photoId, width, height, color, description, urls, photographer, photoPageUrl, downloadLocation, tags }`

### `discovery.js`
- `CURATED_TOPICS = [{ id, label, query }]`
- `acquirePhoto(photo, { query, topic, signal }) -> UnsplashRecord`: reserve → fetch the image bytes → decode check → thumbnail → `putUnsplash` (evict and retry once on a storage quota error) → `trackDownload` (fire and forget) → commit. Releases the reservation on any failure. If the photo is already cached, returns the cached record without reserving.
- `changeUnsplashBackground({ settings, signal }) -> { record, origin: 'cache' | 'new', quota }`:
  1. Use a cached image matching the current topics/keyword that has never been displayed.
  2. Otherwise, if the quota allows and the browser is online, fetch a random/search photo not already cached and acquire it.
  3. Otherwise rotate to the least-recently-used cached image.
  4. Otherwise throw (`QuotaError` or `UnsplashError`).
- `searchWallpapers({ query, page, signal }) -> { results: (NormalizedPhoto & { cached: boolean })[], fromCache: boolean, limitReached: boolean, totalPages }`. When the limit is reached or the browser is offline, only the local cache is searched (no API call).

### `wallpaperRenderer.js`
- `showWallpaper(ref, { onColor } = {}) -> Promise<boolean>`: resolves the URL (Unsplash: hotlinked `pickUnsplashUrl` when online with a blob fallback; local: blob object URL), decodes it, then crossfades. Sets `body` `background-image` and `--page-bg-url`. Revokes the previous object URL only after the swap. A newer call supersedes an older one (returns false). On failure it keeps the current wallpaper and rejects. `onColor(hex)` is for the clock's Vibrant Colour style, called only when `wantsColor()` (asked once the image is on screen) returns true: it gets the wallpaper's dominant colour (Vibrant, loaded on first use; cached per URL).
- `requestWallpaperColor(onColor)`: the colour of the wallpaper on screen, for a clock switching to Vibrant Colour.
- `showDefaultWallpaper()` (the existing default Unsplash URL)
- `clearWallpaper()`
