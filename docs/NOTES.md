# Notes and Daily Tasks

Notes is iWeb's Markdown notebook. It holds two kinds of note in one collection:

- **Notes**: Markdown, as before (Write / Preview).
- **Task Notes**: Markdown checklists with a Checklist view, optional due dates and priorities, and the option to put the note on the desktop as a sticky card.

Both kinds share the same storage and editor, and both show up in search. A Task Note is an ordinary note with `kind: 'task'`, so it can be converted back to a regular note.

## Contents

1. [Using it](#using-it)
2. [Architecture](#architecture)
3. [Data model](#data-model)
4. [Markdown is the source of truth](#markdown-is-the-source-of-truth)
5. [Storage, migration and backups](#storage-migration-and-backups)
6. [Saving and keeping everything in step](#saving-and-keeping-everything-in-step)
7. [Desktop sticky cards](#desktop-sticky-cards)
8. [Keyboard shortcuts](#keyboard-shortcuts)
9. [Performance](#performance)
10. [Known limitations](#known-limitations)
11. [Testing](#testing)

## Using it

The window has three columns, after macOS 26 Notes:

| Column | What it holds |
|---|---|
| Sidebar | **Note** and **Task** buttons; **All Notes** and **Pinned**; the task views **Today**, **Overdue**, **Upcoming**, **All Tasks** and **Completed**; and **Tags** (`#work` in a note's text). A view only appears when it has something in it. All Notes, Today and All Tasks always appear. |
| List | The view's notes. Pinned notes come first, then the notes are grouped by date. Sort by date edited, date created, title or due date. Search looks through every note. A Task Note's row shows its progress and next due date. |
| Editor | The open note. Notes have **Write** and **Preview**; Task Notes have **Checklist** and **Write**. Buttons: pin, show on desktop (Task Notes), ⋯ (rename, duplicate, convert, delete) and delete. |

In Today, Overdue and Upcoming, each row lists the tasks that put the note in that view, and they can be ticked there. A task you tick stays in the view, struck through, until you move to another view (as in Reminders).

**Opening.** Notes reopens on the note that was open last, in the mode last used for that kind of note. It also restores the view, sort, sidebar and the hide-completed setting (localStorage `iweb:notesUi`). With no notes, the editor offers **New Note** and **New Task Note**.

- **New Note** opens a blank note in Write with the title selected.
- **New Task** opens a Task Note titled with today's date (for example "Monday, 2 November") in Checklist, with the cursor in **Add a task**.

**Checklist view.** Each task can be ticked, renamed (click its text), reordered (drag the grip, or Alt+↑ / Alt+↓), and deleted (⋯ menu, or Delete on a focused checkbox). The ⋯ menu also sets a due date (Today, Tomorrow, Next Week, Choose a Date…) and a priority (None, Low, Medium, High). The note's other Markdown (paragraphs, headings, code) renders between the task lists, in the order it was written. **Hide Completed** and **Clear Completed…** sit above the list; clearing asks first, and nothing is ever deleted on its own.

## Architecture

| File | Role |
|---|---|
| `src/libs/notes/tasks.js` | Parses checklist lines and edits them: tick, text, due date, priority, move, add, delete, clear completed. Also dates, tags, and the Checklist view's segments. Pure functions. |
| `src/libs/notes/notesStore.js` | The notes collection: IndexedDB, the in-memory copy, tab-to-tab sync, flushing an editor before outside changes. `useNotes()` for React. |
| `src/libs/notes/views.js` | Per-note summaries (cached per record), the sidebar views and counts, search, list sections and sorting. Pure functions. |
| `src/libs/notes/stickyStore.js` | Which notes are on the desktop and where (localStorage). `useStickies()`. |
| `src/libs/notes/stickyPlacement.js` | A free spot for a new card, and where a dropped card lands. |
| `src/libs/notes/notesEvents.js` | `openNotes({ noteId } \| { create })`, used by the Dock, the menu bar and the cards. |
| `src/libs/notes/useToday.js` | Today's date in React state; moves on at midnight. |
| `src/components/Notes.jsx` | The window: draft, autosave, undo, the editor, menus and shortcuts. |
| `src/components/notes/` | `NotesSidebar`, `NoteList`, `TaskChecklist`, `StickyLayer` (the desktop cards), `PopupMenu`, `notesIcons`. |
| `src/styles/notes-*.css` | `notes-workspace` (the window), `notes-tasks` (checkboxes, chips, progress; shared), `notes-sticky` (the cards). The older `notes-sidebar` and `notes-markdown` stylesheets are kept. |

**Loading.**

- **Notes chunk** (≈ 11 kB gzipped): loads lazily. When the desktop is idle, App fetches the chunk and the notes themselves, so the first open is immediate. Once the code is in, App renders the window directly rather than through `React.lazy`, which would otherwise hold the window back for about 300 ms.
- **Sticky cards** (≈ 2.4 kB): their own chunk, loaded only while at least one card exists.

## Data model

A note record, in the `notes` store:

```js
{
  id: 7,                    // auto-increment key (unchanged)
  title: 'Monday, 2 November',
  content: '- [ ] Review pull request !! 📅 2026-11-03\n- [x] Fix login issue',
  updatedAt: 1793600000000, // as before
  createdAt: 1793500000000, // new notes only (older notes sort by updatedAt instead)
  kind: 'task',             // Task Notes only; absent on regular notes
  pinned: true,             // only while pinned
}
```

Fields that are absent mean "no": a note from before the upgrade is a regular, unpinned note. An empty title is stored as typed and shown as "Untitled Note".

A task is a GitHub checklist line. Optional metadata goes at the end of the line:

```md
- [ ] Review pull request !! 📅 2026-11-03
```

| Token | Meaning |
|---|---|
| `!` / `!!` / `!!!` | Priority: low, medium, high (as in Apple Reminders). |
| `📅 YYYY-MM-DD` | Due date. A local calendar day, compared as a string, never converted to UTC. |

The metadata is plain text, so exported Markdown stays readable anywhere. Tasks without metadata are plain GFM.

## Markdown is the source of truth

There is no separate task database. The Checklist view, the date views, progress, and the desktop cards are all parsed from the note's text (`parseTasks`). Every change rewrites only the line(s) concerned:

- **Ticking** changes the one `x`/space character, and nothing else on the line.
- **Renaming, due dates and priorities** rewrite that one line, keeping its quote prefix, indent and bullet.
- **Moving** moves the task's line together with the lines indented under it.
- **Adding** inserts a line after the last task, in that list's style; numbered lists count on.
- **Deleting** removes the line and its indented lines. **Clear Completed** removes completed lines only; their unchecked sub-tasks stay.

**What counts as a task.** The parser counts exactly the boxes `marked` renders. It skips `- [ ]` with no text, `- [x]text` with no space, and lines inside fenced or indented code. A test compares the two on edge cases. This also fixed a bug in Preview: ticking a box below a code block that contained `- [ ]` used to flip the wrong line.

**Finding a task again.** A task is addressed by a ref `{ index, text, nth }`: its position, its text, and which occurrence of that text it is. If the note changed since the ref was taken (typed in Write, edited in another tab), the ref is resolved in this order:

1. the task at that index, if its text still matches;
2. the nth task with that text, so duplicates such as two "milk" tasks keep their identity;
3. the nearest task with that text.

If no task has that text any more, the change is **skipped**. It is never applied to a different line.

**Editing Markdown by hand** needs no reconciliation step, because there is nothing to reconcile: the next parse simply reflects the new text. A deleted line is a deleted task, and a rewritten line is a new task.

## Storage, migration and backups

- **Same database.** Notes still uses IndexedDB `iweb-notes-db`, **version 1**, store `notes`. The schema is unchanged (IndexedDB doesn't constrain record fields), so there is no version bump, no migration step, and nothing to roll back. Backups also open the database at version 1.
- **Old records are never rewritten.** Notes from before the upgrade are read through `normalizeNote`, which never writes back. A record is only written when you change that note, and a write changes only the fields concerned. A test checks that loading old notes leaves their stored bytes identical, however many times it runs.
- **The pre-IndexedDB format.** Notes once lived as `localStorage['notes']`, an array of strings. They are still moved over on first load, and the key is now removed only after every note has been added. Unreadable data is left alone.
- **Backups.** A backup's `notes.json` includes the new fields, and restoring puts them back. Restoring tells other open tabs to re-read their notes. Desktop card positions (localStorage) are not part of a backup.
- **Recovery.** The fields are additive, so an older iWeb reading these records ignores `kind`, `pinned` and `createdAt` and shows the notes as plain Markdown.

## Saving and keeping everything in step

**The window keeps a draft of the open note.**

- **Typing** is saved 0.8 s after it stops.
- **Checklist changes** (ticking, adding, moving, due dates) are saved at once.
- **Pending typing** is also saved when you switch notes, close or minimise the window, hide the tab, or leave the page.
- **Status.** The header shows Saving, Saved or Save Failed. On failure the text stays in the window and is saved with the next change.

**Writes and tabs.**

- Every write is a read-modify-write on the stored record in one transaction, so it only replaces the fields it changes. For example, ticking a task never undoes a pin made in another tab.
- A change shows locally at once. Other tabs hear about it on the `iweb-notes` BroadcastChannel and re-read that one note.

**Changes from outside the window** (a sticky card, another tab, a date view):

- If you are typing in the same note, the window first saves your typing (`registerFlush`), then the change is applied. Neither is lost, and a test covers this.
- The window then takes the change into the draft, as an undoable step.
- If the open note was deleted elsewhere, the window moves to the next note. If a save reaches a note deleted in another tab, the note is written back rather than losing the edit.

## Desktop sticky cards

**Show on Desktop** (editor toolbar, ⋯ menu, File menu, or a row's right-click menu) puts a Task Note on the desktop as a card. A new card is clear frosted glass with white text. From its ⋯ menu → **Color** (or the note's ⋯ menu → **Card Color** in Notes) it can become a paper sticky in one of the macOS 26 Stickies colours (Yellow, Blue, Green, Pink, Purple, Gray), and **None (Glass)** turns it back.

**What a card shows and does:**

- the title, `done/total`, and a progress bar;
- the tasks, which can be ticked, with their due dates and priorities;
- an **Add a task** field;
- a ⋯ menu: **Open in Notes**, Compact / Expand, Hide Completed Tasks, Remove from Desktop.

**A card is a live view of its note, not a copy.** It stores only the note id and how the card looks:

```js
// localStorage 'iweb:stickyNotes'
{ version: 1, cards: { '7': { ax: 'right', x: 16, ay: 'top', y: 176, expanded: false, hideDone: false, color: null, z: 0 } } }
```

Ticking or adding on a card goes through `updateContent` on the note, and an edit in Notes shows on the card at once.

**Position.**

- A position is kept relative to the nearest screen edge or the centre (`ax`/`ay`, the desktop layout's anchors), so a card stays put when the window is resized.
- Cards are clamped on screen when drawn, so a card can never end up out of reach.
- A new card takes the first free spot from the top right, clear of widgets, the Dynamic Island, the Dock and other cards.
- A dropped card is nudged off the Island and the Dock, but it may overlap widgets: cards float above them, like windows.

**Moving.**

- Drag a card by its title bar. A drag starting on a checkbox, button or field doesn't move it.
- With the title focused, the arrow keys move the card (Shift for bigger steps), and Enter opens the note in Notes.
- The position is saved once, when the drag ends; while dragging, the card moves with a transform on animation frames.

**Layering.**

| Layer | z-index |
|---|---|
| Widgets | 1000 |
| Cards | 1010 and up; clicking a card brings it to the front |
| App windows | 1100 |
| Menus | 100000 |

- **Edit Widgets:** cards fade and let the pointer through, so widgets can be arranged under them.
- **Focus** (Control Center): cards hide.
- **Right-click** on a card opens its own menu, not the desktop's.

**Removing.**

- The card's **×** removes the card. The note stays.
- **Deleting the note** warns that the card will go too, then removes it.
- **Converting** a Task Note to a regular note takes its card off the desktop.
- A card whose note is gone (deleted in another tab, or replaced by a restore) is dropped when the notes load.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| Ctrl/Cmd+N | New note (in Chrome, Ctrl+N opens a browser window instead; use the **Note** button or File → New Note) |
| Ctrl/Cmd+Alt+N | New Task Note (ignored for AltGr+N, which types a letter on some keyboards) |
| Ctrl/Cmd+S | Save now |
| Ctrl/Cmd+Shift+P | Write ⇄ Preview, or Write ⇄ Checklist |
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y | Undo / redo, including checklist changes |
| Ctrl/Cmd+B, Ctrl/Cmd+I | Bold, italic (Write) |
| Escape | Clear the search if it has focus; otherwise close Notes |
| ↑ / ↓ | Move between tasks (Checklist) |
| Space | Tick or untick the focused task |
| Ctrl/Cmd+Enter | Tick or untick the focused task |
| Enter | Rename the focused task |
| Delete / Backspace | Delete the focused task |
| Alt+↑ / Alt+↓ | Move the focused task past its neighbour |
| Arrow keys, Enter | Move a focused sticky card; open it in Notes |

Notes only handles these keys while it is the front window.

## Performance

**Summaries.** Each note's summary (snippet, tasks, tags, search text) is computed once per stored record (WeakMap). Typing doesn't touch the list: the list only re-renders when a save lands, and only the changed row repaints.

**Long lists.** The list renders its first 60 rows, and more as you scroll near the end. The open note is always rendered.

**Measured** with 1,000 notes (a third of them Task Notes), production build, headless Chrome:

| What | Time |
|---|---|
| Summaries for the sidebar | 34 ms once, then cached |
| Switching views | 50–70 ms |
| Search | about 26 ms |
| Typing | no long tasks |
| Opening the window | rows are in its first frame |

**Sticky cards** use one backdrop blur each while they're glass; paper colours are opaque and have none.

## Known limitations

- **No reminders or notifications.** iWeb has no reliable way to fire one while no tab is open, so due dates are shown, not alerted.
- **Due dates and priorities belong to tasks, not to notes.** A note's "next due" is its earliest open task.
- **Folders and Smart Folders aren't implemented.** Tags (`#word` in the text) and the task views cover filtering for now.
- **A line ending in a lone ` !`, ` !!` or ` !!!` reads as a priority.** Such a task can be renamed from the Checklist view, which writes the text without the marks.
- **Simultaneous typing in the same note in two tabs: last save wins.** Ticks and other single-task changes from another tab are merged.
- **The Checklist view only shows a task's own line.** Lines indented under a task (continuation text) are visible in Write.
- **Narrow windows.** The sidebar folds to icons below about 1,040 px of window width. It can be hidden with the sidebar button or View → Hide Sidebar.
- **No startup preference yet.** There is no "start with a new note" or "show the overview" option; Notes always resumes the last note.

## Testing

Unit tests (`npm test`):

- `tasks.test.js` covers parsing, matching `marked`'s count on edge cases, metadata, every edit, duplicate and stale refs, Windows line endings, local dates, tags and checklist segments.
- `notesStore.test.js` covers loading old notes without rewriting them, the localStorage move, partial updates keeping unknown fields, optimistic updates, ticks merging with changes made elsewhere, flushing pending typing first, skipped stale ticks, and edits to a note deleted elsewhere.
- `views.test.js` covers summaries, every view, counts, kept ticks, search and sorting.
- `stickyStore.test.js` covers pinning, moving, stacking order, pruning and damaged saved state.

In the browser (Playwright against the dev server and a production build), the following were checked, with no console errors from Notes:

- Task Notes: create, add, tick, due dates and priorities, Write ⇄ Checklist, typed tasks, drag and keyboard reordering, delete and undo, hide completed.
- Date views, including ticking from a view.
- Regular notes: create, Preview ticks below a code block, search, pin, reopening on the last note.
- Sticky cards: drag, persistence across reloads, two-way sync, typing plus an outside tick, resize clamping, two cards with z-order, keyboard moves, removing a card, and deleting a note with a card.
- Two tabs in sync.
- Edit Widgets dimming.
- The narrow layout.
- 1,000 notes.
