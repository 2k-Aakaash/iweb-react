// Headline rotation for the News widget: every 10 seconds the next article already in memory.
// It never fetches. The timer only reads the latest article list through getIds(), so new
// articles arriving (or any re-render) never restart it.
import { NEWS_CONFIG } from './newsConfig';

/**
 * The next article id: one not yet shown this cycle and never the current one again; once
 * every article has been shown, a new cycle starts. Fewer than two articles: no change.
 * @returns {{ current: string|null, seen: Set<string> }}
 */
export function nextHeadline(ids, current, seen) {
  if (!ids.length) return { current: null, seen: new Set() };
  if (!ids.includes(current)) return { current: ids[0], seen: new Set([ids[0]]) };
  if (ids.length < 2) return { current, seen };
  const shown = new Set([...seen].filter((id) => ids.includes(id)));
  shown.add(current);
  const start = ids.indexOf(current);
  for (let step = 1; step < ids.length; step++) {
    const candidate = ids[(start + step) % ids.length];
    if (!shown.has(candidate)) return { current: candidate, seen: new Set([...shown, candidate]) };
  }
  // Every article shown: a new cycle, starting after the current one.
  const next = ids[(start + 1) % ids.length];
  return { current: next, seen: new Set([current, next]) };
}

/**
 * A rotation timer. getIds() returns the current article ids (newest first); onChange(id) is
 * called with the headline to show. One interval for its whole life; stop() clears it.
 */
export function createRotation({ getIds, onChange, intervalMs = NEWS_CONFIG.rotationIntervalMs }) {
  let current = null;
  let seen = new Set();
  let timer = null;

  const apply = (next) => {
    const changed = next.current !== current;
    current = next.current;
    seen = next.seen;
    if (changed) onChange(current);
  };

  return {
    /** Shows the first headline (or keeps the current one if it is still there). */
    sync() {
      const ids = getIds();
      if (current && ids.includes(current)) return;
      apply({ current: ids[0] ?? null, seen: ids[0] ? new Set([ids[0]]) : new Set() });
    },
    start() {
      if (timer) return;
      this.sync();
      timer = setInterval(() => apply(nextHeadline(getIds(), current, seen)), intervalMs);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    get current() {
      return current;
    },
    get running() {
      return timer !== null;
    },
  };
}
