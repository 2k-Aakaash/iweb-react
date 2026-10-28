// Note list grouping and dates, as the macOS Notes sidebar shows them.

const DAY = 24 * 60 * 60 * 1000;

const startOfDay = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Section label for a note edited at `t`, relative to `now`. */
export function groupLabel(t, now = Date.now()) {
  const today = startOfDay(now);
  const day = startOfDay(t);
  if (day >= today) return 'Today';
  if (day >= today - DAY) return 'Yesterday';
  if (day >= today - 7 * DAY) return 'Previous 7 Days';
  if (day >= today - 30 * DAY) return 'Previous 30 Days';
  const date = new Date(t);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' });
}

/** Notes newest first, split into [{ label, notes }] sections. */
export function groupNotes(notes, now = Date.now()) {
  const sorted = [...notes].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const groups = [];
  for (const note of sorted) {
    const label = groupLabel(note.updatedAt ?? 0, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.notes.push(note);
    else groups.push({ label, notes: [note] });
  }
  return groups;
}

/** Row date: the time for today, the weekday this week, otherwise a short date. */
export function rowDate(t, now = Date.now()) {
  const date = new Date(t);
  const today = startOfDay(now);
  const day = startOfDay(t);
  if (day >= today) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (day >= today - DAY) return 'Yesterday';
  if (day >= today - 6 * DAY) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'numeric', year: '2-digit' });
}
