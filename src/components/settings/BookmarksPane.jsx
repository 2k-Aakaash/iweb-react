import { useEffect, useState } from 'react';
import { useFavicons } from '../../libs/favicons/useFavicons';
import {
  addBookmark,
  domainOf,
  moveBookmark,
  removeBookmark,
  saveBookmarks,
  clearBookmarkEdit,
  peekBookmarkEdit,
  updateBookmark,
} from '../../libs/dock/bookmarks';
import '../../styles/settings-bookmarks.css';

// Settings → Bookmarks: the Dock's bookmarks as a macOS list. Select a row; double-click (or
// Edit) to change its name and address; drag, or Alt+↑/↓, to reorder; + adds, − removes (with
// Undo). Changes show in the Dock at once (App state) and are saved (libs/dock/bookmarks.js).

const FALLBACK_ICON = 'https://ik.imagekit.io/026k2i7ys/iWeb%20Favicon.svg?updatedAt=1700227200100';

function Icon({ bookmark, cached }) {
  const [broken, setBroken] = useState(false);
  const src = broken ? FALLBACK_ICON : cached || bookmark.favicon || FALLBACK_ICON;
  return <img className="bm-icon" src={src} alt="" draggable={false} onError={() => setBroken(true)} />;
}

function EditForm({ initial, submitLabel, onSubmit, onCancel }) {
  const [name, setName] = useState(initial.name);
  const [url, setUrl] = useState(initial.url);
  const [error, setError] = useState('');
  const submit = (e) => {
    e.preventDefault();
    const message = onSubmit({ name, url });
    if (message) setError(message);
  };
  return (
    <form className="bm-form" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onCancel())}>
      <div className="bm-form-fields">
        <input className="bm-input" aria-label="Name" placeholder="Name (e.g. Reddit)" value={name} autoFocus onChange={(e) => { setName(e.target.value); setError(''); }} />
        <input className="bm-input" aria-label="Address" placeholder="Address (e.g. reddit.com)" value={url} onChange={(e) => { setUrl(e.target.value); setError(''); }} />
      </div>
      {error && <p className="bm-error" role="alert">{error}</p>}
      <div className="bm-form-actions">
        <button type="button" className="settings-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="settings-btn settings-btn-primary">{submitLabel}</button>
      </div>
    </form>
  );
}

export default function BookmarksPane({ bookmarks, setBookmarks }) {
  // "Edit in Settings…" from the Dock's menu opens on that bookmark.
  const [firstEdit] = useState(() => peekBookmarkEdit(bookmarks));
  const [selected, setSelected] = useState(firstEdit);
  const [editing, setEditing] = useState(firstEdit); // a row's index, or 'new'
  const [dragFrom, setDragFrom] = useState(null);
  const [removed, setRemoved] = useState(null); // { item, index } for Undo
  const cached = useFavicons(bookmarks.map((b) => domainOf(b.url)));
  useEffect(() => clearBookmarkEdit(), []);
  // …also when Settings is already showing this pane.
  useEffect(() => {
    const onOpen = (e) => {
      if (e.detail?.tab !== 'bookmarks') return;
      const index = peekBookmarkEdit(bookmarks);
      clearBookmarkEdit();
      if (index >= 0) {
        setSelected(index);
        setEditing(index);
      }
    };
    window.addEventListener('settings:open', onOpen);
    return () => window.removeEventListener('settings:open', onOpen);
  }, [bookmarks]);

  const commit = (list) => {
    setBookmarks(list);
    saveBookmarks(list);
  };
  const move = (from, to) => {
    if (to < 0 || to >= bookmarks.length) return;
    commit(moveBookmark(bookmarks, from, to).list);
    setSelected(to);
  };
  const remove = (index) => {
    if (!bookmarks[index]) return;
    setRemoved({ item: bookmarks[index], index });
    commit(removeBookmark(bookmarks, index).list);
    setSelected(Math.min(index, bookmarks.length - 2));
    setEditing(-1);
  };
  const undo = () => {
    if (!removed) return;
    const list = [...bookmarks];
    list.splice(Math.min(removed.index, list.length), 0, removed.item);
    commit(list.map((b, i) => ({ ...b, order: i })));
    setSelected(removed.index);
    setRemoved(null);
  };
  const onRowKey = (e, index) => {
    if (editing !== -1) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      move(index, index + (e.key === 'ArrowUp' ? -1 : 1));
      requestAnimationFrame(() => document.querySelector(`[data-bm-row="${index + (e.key === 'ArrowUp' ? -1 : 1)}"]`)?.focus());
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.max(0, Math.min(bookmarks.length - 1, index + (e.key === 'ArrowUp' ? -1 : 1)));
      setSelected(next);
      document.querySelector(`[data-bm-row="${next}"]`)?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      setEditing(index);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(index);
    }
  };

  return (
    <div className="settings-tab-pane bm-pane">
      <div className="settings-group-card-title">Dock Bookmarks</div>
      <div className="settings-group-card bm-card">
        {bookmarks.length === 0 && editing !== 'new' && (
          <p className="bm-empty">No bookmarks in the Dock yet. Add one with +.</p>
        )}
        <ul className="bm-list" aria-label="Dock bookmarks">
          {bookmarks.map((b, index) => (
            <li
              key={b.websiteName}
              data-bm-row={index}
              className={`bm-row${selected === index ? ' is-selected' : ''}${dragFrom === index ? ' is-dragging' : ''}`}
              tabIndex={0}
              aria-selected={selected === index}
              draggable={editing === -1}
              onClick={() => setSelected(index)}
              onDoubleClick={() => setEditing(index)}
              onKeyDown={(e) => onRowKey(e, index)}
              onDragStart={(e) => {
                setDragFrom(index);
                setSelected(index);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(index));
              }}
              onDragOver={(e) => {
                if (dragFrom === null) return;
                e.preventDefault();
                if (dragFrom !== index) {
                  commit(moveBookmark(bookmarks, dragFrom, index).list);
                  setDragFrom(index);
                  setSelected(index);
                }
              }}
              onDragEnd={() => setDragFrom(null)}
            >
              {editing === index ? (
                <EditForm
                  initial={{ name: b.websiteName, url: b.url }}
                  submitLabel="Save"
                  onCancel={() => setEditing(-1)}
                  onSubmit={(values) => {
                    const result = updateBookmark(bookmarks, index, values);
                    if (result.error) return result.error;
                    commit(result.list);
                    setEditing(-1);
                    return null;
                  }}
                />
              ) : (
                <>
                  <span className="bm-handle" aria-hidden="true">⋮⋮</span>
                  <Icon bookmark={b} cached={cached[domainOf(b.url)]} />
                  <span className="bm-text">
                    <span className="bm-name">{b.websiteName}</span>
                    <span className="bm-url">{domainOf(b.url)}</span>
                  </span>
                  <button type="button" className="settings-btn bm-edit" onClick={(e) => { e.stopPropagation(); setEditing(index); }}>
                    Edit
                  </button>
                </>
              )}
            </li>
          ))}
          {editing === 'new' && (
            <li className="bm-row is-new">
              <EditForm
                initial={{ name: '', url: '' }}
                submitLabel="Add"
                onCancel={() => setEditing(-1)}
                onSubmit={(values) => {
                  const result = addBookmark(bookmarks, values);
                  if (result.error) return result.error;
                  commit(result.list);
                  setSelected(result.list.length - 1);
                  setEditing(-1);
                  return null;
                }}
              />
            </li>
          )}
        </ul>
        <div className="bm-toolbar">
          <button type="button" className="bm-tool" aria-label="Add a bookmark" title="Add" onClick={() => { setEditing('new'); setRemoved(null); }}>+</button>
          <button type="button" className="bm-tool" aria-label="Remove the selected bookmark" title="Remove" disabled={selected < 0 || !bookmarks[selected]} onClick={() => remove(selected)}>−</button>
          <span className="bm-status" aria-live="polite">
            {removed ? (
              <>
                Removed “{removed.item.websiteName}”.{' '}
                <button type="button" className="bm-link" onClick={undo}>Undo</button>
              </>
            ) : (
              `${bookmarks.length} ${bookmarks.length === 1 ? 'bookmark' : 'bookmarks'}`
            )}
          </span>
        </div>
      </div>
      <p className="settings-row-hint bm-hint">
        Drag a bookmark, or press Alt+↑ / ↓, to change its place in the Dock. Double-click one to rename it or change its address.
      </p>
    </div>
  );
}
