// Opening Notes from elsewhere (the Dock, the menu bar, a desktop sticky card). The window
// loads on its first open, so App keeps the request and hands it over once Notes mounts.

export const NOTES_OPEN_EVENT = 'notes:open';

/** Opens Notes; `{ noteId }` selects that note, `{ create: 'note' | 'task' }` starts one. */
export function openNotes(detail = {}) {
  window.dispatchEvent(new CustomEvent(NOTES_OPEN_EVENT, { detail }));
}
