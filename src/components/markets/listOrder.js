// Watchlist reordering maths for drag-and-drop and Alt+Arrow moves.

/** Copy of `list` with the item at `from` moved to index `to` (clamped to the list). */
export function moveItem(list, from, to) {
  const next = list.slice();
  if (from < 0 || from >= list.length) return next;
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (target === from) return next;
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

/**
 * Final index of the item at `from` when it is dropped before or after the item at `over`
 * (indices in the list before the move).
 */
export function dropIndex(from, over, position) {
  const to = position === 'after' ? over + 1 : over;
  return from < to ? to - 1 : to;
}
