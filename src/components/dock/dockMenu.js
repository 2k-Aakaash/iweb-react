// The Dock's right-click menus, as in macOS 26 (Dock.jsx shows them with PopupMenu):
//
//   a bookmark          Open, Open in New Window, Copy Link · Edit in Settings…, Move Left /
//                       Right · Remove from Dock
//   a built-in app      Show / Open, the app's own items (Notes: New Note, New Task; Music:
//                       playback), Quit while it runs
//   the divider / Dock  Magnification on or off, Small / Medium / Large, Dock Settings…
//
// Items: { label, onSelect, checked?, disabled?, danger? }, { type: 'separator' } or
// { type: 'header', label }.
import { getController } from '../../libs/window/windowRegistry';
import { getPlayer, nextTrack, playPause, previousTrack } from '../../libs/music/playerStore';
import { openNotes } from '../../libs/notes/notesEvents';
import { requestBookmarkEdit } from '../../libs/dock/bookmarks';
import { getAmbience } from '../../libs/ambience/store.js';
import { environmentById } from '../../libs/ambience/environments/index.js';
import { DOCK_SIZE_PRESETS, dockMagnificationPref, dockSizePref } from '../../libs/dock/dockPrefs';

const SEP = { type: 'separator' };
const settings = (tab) => window.dispatchEvent(new CustomEvent('settings:open', { detail: { tab } }));

export function bookmarkMenu({ bookmark, index, count, move, remove }) {
  return [
    { type: 'header', label: bookmark.websiteName },
    { label: 'Open', onSelect: () => window.open(bookmark.url, '_blank', 'noopener,noreferrer') },
    { label: 'Open in New Window', onSelect: () => window.open(bookmark.url, '_blank', 'noopener,noreferrer,popup') },
    { label: 'Copy Link', onSelect: () => navigator.clipboard?.writeText(bookmark.url).catch(() => {}) },
    SEP,
    {
      label: 'Edit in Settings…',
      onSelect: () => {
        requestBookmarkEdit(bookmark.websiteName);
        settings('bookmarks');
      },
    },
    { label: 'Move Left', disabled: index === 0, onSelect: () => move(index, index - 1) },
    { label: 'Move Right', disabled: index === count - 1, onSelect: () => move(index, index + 1) },
    SEP,
    { label: 'Remove from Dock', danger: true, onSelect: () => remove(index) },
  ];
}

const APP_NAMES = { notes: 'Notes', music: 'Music', settings: 'Settings', markets: 'Markets', news: 'News', atmosphere: 'Atmosphere', frontier: 'Frontier World' };

export function appMenu({ app, state, open, actions }) {
  if (app === 'apps') {
    return [
      { label: 'Open Apps', onSelect: () => window.dispatchEvent(new Event('apps:toggle')) },
      SEP,
      { label: 'Add App…', onSelect: actions.addApp },
    ];
  }
  if (app === 'bg') {
    return [
      { label: 'Next Wallpaper', onSelect: actions.changeBg },
      SEP,
      { label: 'Wallpaper Settings…', onSelect: () => settings('wallpaper') },
    ];
  }
  const running = state === 'open' || state === 'minimized';
  const controller = getController(app);
  const items = [{ type: 'header', label: APP_NAMES[app] || app }];
  if (app === 'notes') {
    items.push(
      { label: 'New Note', onSelect: () => openNotes({ create: 'note' }) },
      { label: 'New Task', onSelect: () => openNotes({ create: 'task' }) },
      SEP,
    );
  }
  if (app === 'music') {
    const player = getPlayer();
    if (player.available && player.track) {
      items.push(
        { type: 'header', label: `${player.track.title}${player.track.artist ? ` — ${player.track.artist}` : ''}` },
        { label: player.playing ? 'Pause' : 'Play', onSelect: playPause },
        { label: 'Next', onSelect: nextTrack },
        { label: 'Previous', onSelect: previousTrack },
        SEP,
      );
    }
  }
  if (app === 'frontier') {
    const ambience = getAmbience();
    const s = ambience.getState();
    const onPlace = Boolean(environmentById(s.environmentId)?.frontier);
    items.push(
      { label: onPlace && s.status === 'playing' ? 'Pause' : 'Play', disabled: !onPlace, onSelect: () => ambience.toggle() },
      { label: 'Next Place in Destination', disabled: !onPlace, onSelect: () => ambience.nextEnvironment() },
      SEP,
    );
  }
  if (app === 'atmosphere') {
    const ambience = getAmbience();
    const playing = ambience.getState().status === 'playing';
    items.push(
      { label: playing ? 'Pause' : 'Play', onSelect: () => ambience.toggle() },
      { label: environmentById(ambience.getState().environmentId)?.frontier ? 'Next Place in Destination' : 'Next Environment', onSelect: () => ambience.nextEnvironment() },
      { label: 'Shuffle', onSelect: () => ambience.randomize() },
      SEP,
    );
  }
  if (app === 'settings') {
    items.push(
      { label: 'Appearance…', onSelect: () => settings('appearance') },
      { label: 'Wallpaper…', onSelect: () => settings('wallpaper') },
      { label: 'Widgets…', onSelect: () => settings('widgets') },
      SEP,
    );
  }
  items.push({ label: state === 'minimized' ? 'Show' : running ? 'Show' : 'Open', onSelect: open });
  if (running) items.push(SEP, { label: 'Quit', onSelect: () => controller?.close?.() });
  return items;
}

export function dockMenu() {
  const magnification = dockMagnificationPref.get();
  const size = dockSizePref.get();
  return [
    {
      label: magnification === 'off' ? 'Turn Magnification On' : 'Turn Magnification Off',
      onSelect: () => dockMagnificationPref.set(magnification === 'off' ? 'medium' : 'off'),
    },
    SEP,
    { type: 'header', label: 'Size' },
    ...DOCK_SIZE_PRESETS.map((p) => ({ label: p.label, checked: size === p.size, onSelect: () => dockSizePref.set(p.size) })),
    SEP,
    { label: 'Dock Settings…', onSelect: () => settings('appearance') },
  ];
}
