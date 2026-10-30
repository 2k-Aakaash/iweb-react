import { useEffect, useRef, useState } from 'react';
import ControlTile from './ControlTiles';
import ControlView from './ControlViews';
import { MinusIcon, PlusIcon } from './ccIcons';
import { CONTROLS, hiddenControls, moveControl } from '../../libs/controlcenter/controls';
import { controlsPref } from '../../libs/controlcenter/ccPrefs';
import { usePref } from '../../libs/prefs/storedPref';
import { captureScreenshot } from '../../libs/controlcenter/screenshot';
import { getController, useWindows } from '../../libs/window/windowRegistry';
import { setEditing } from '../../libs/desktop/layoutStore';
import '../../styles/controlcenter.css';

// Control Center, after macOS 26's: opened from the menu bar (MenuBar.jsx), under its
// top-right corner. Glass tiles on a 4-column grid (ControlTiles.jsx); some open a view in
// place of the grid (ControlViews.jsx). Edit Controls adds, removes and reorders them (drag),
// saved in iWebDB. Escape goes back, then closes; so does a click anywhere else.

// Leaves the menu bar's Control Center button alone (it toggles the panel itself).
const TOGGLE_SELECTOR = '[data-cc-toggle]';

export default function ControlCenter({ initialView = 'grid', onClose }) {
  const [view, setView] = useState(initialView);
  const [editing, setEditingControls] = useState(false);
  const [dragId, setDragId] = useState(null);
  const shown = usePref(controlsPref);
  const { windows } = useWindows();
  const panelRef = useRef(null);

  // Escape: back from a view, out of editing, then close. Outside presses close.
  const escapeRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
    escapeRef.current = () => {
      if (view !== 'grid') setView('grid');
      else if (editing) setEditingControls(false);
      else onClose();
    };
  });
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation(); // not also the window or Spotlight underneath
      escapeRef.current();
    };
    const onPointerDown = (e) => {
      if (panelRef.current?.contains(e.target) || e.target.closest?.(TOGGLE_SELECTOR)) return;
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, []);

  // Focus moves into the panel (Tab then reaches the controls) without ringing a control.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, [view]);

  const ctx = {
    openView: setView,
    close: onClose,
    // Close first, so the page is clear (a screenshot doesn't show the panel).
    run: (fn) => {
      onClose();
      requestAnimationFrame(() => requestAnimationFrame(fn));
    },
    showDesktop: () => {
      for (const w of windows) {
        if (w.state === 'open') getController(w.app)?.minimize?.();
      }
    },
    editWidgets: () => setEditing(true),
    screenshot: () => captureScreenshot(),
  };

  const remove = (id) => controlsPref.set(shown.filter((x) => x !== id));
  const add = (id) => controlsPref.set([...shown, id]);
  const dropOn = (beforeId) => {
    if (dragId) controlsPref.set(moveControl(shown, dragId, beforeId));
    setDragId(null);
  };

  return (
    <div ref={panelRef} className={`cc${editing ? ' is-editing' : ''}`} role="dialog" aria-label="Control Center" tabIndex={-1}>
      {view !== 'grid' ? (
        <ControlView view={view} onBack={() => setView('grid')} />
      ) : (
        <>
          <div className="cc-grid" onDragOver={(e) => editing && e.preventDefault()} onDrop={() => editing && dropOn(null)}>
            {shown.map((id, i) => (
              <div
                key={id}
                className={`cc-cell cc-${CONTROLS[id].size}${dragId === id ? ' is-dragging' : ''}`}
                style={{ '--i': i }}
                draggable={editing}
                onDragStart={(e) => {
                  setDragId(id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', id);
                }}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => {
                  if (!editing) return;
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  if (!editing) return;
                  e.preventDefault();
                  e.stopPropagation();
                  dropOn(id);
                }}
              >
                <div className="cc-cell-inner" inert={editing || undefined}>
                  <ControlTile id={id} ctx={ctx} />
                </div>
                {editing && (
                  <button type="button" className="cc-remove" aria-label={`Remove ${CONTROLS[id].label}`} onClick={() => remove(id)}>
                    <MinusIcon size={9} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {editing && (
            <section className="cc-more" aria-label="More controls">
              <h2>{hiddenControls(shown).length ? 'Add Controls' : 'All controls are shown'}</h2>
              <ul>
                {hiddenControls(shown).map((id) => (
                  <li key={id}>
                    <button type="button" className="cc-more-item" onClick={() => add(id)}>
                      <span className="cc-more-plus"><PlusIcon size={9} /></span>
                      {CONTROLS[id].label}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="cc-note">Drag controls to reorder them.</p>
            </section>
          )}
          <button type="button" className="cc-edit-btn" onClick={() => setEditingControls((v) => !v)}>
            {editing ? 'Done' : 'Edit Controls'}
          </button>
        </>
      )}
    </div>
  );
}
