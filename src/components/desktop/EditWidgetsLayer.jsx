import { useEffect } from 'react';
import { ITEMS, addableItems } from '../../libs/desktop/layout';
import { resetLayout, setEditing, showOnDesktop, useDesktop } from '../../libs/desktop/layoutStore';
import { useGuides } from '../../libs/desktop/guides';
import '../../styles/desktop.css';

// Edit Widgets mode around the movable items: a dimmed backdrop (click it to finish), the
// alignment guides while dragging, and a toolbar to add removed widgets, reset or finish.
// Plain frosted CSS, no Liquid Glass. Escape finishes too.
export default function EditWidgetsLayer() {
  const { layout, editing } = useDesktop();
  const guides = useGuides();

  useEffect(() => {
    if (!editing) return undefined;
    document.documentElement.classList.add('desktop-editing');
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) setEditing(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.documentElement.classList.remove('desktop-editing');
      document.removeEventListener('keydown', onKey);
    };
  }, [editing]);

  if (!editing) return null;
  const hidden = addableItems(layout);

  return (
    <>
      <div className="dt-backdrop" onPointerDown={() => setEditing(false)} aria-hidden="true" />
      {guides.x !== null && <div className="dt-guide dt-guide-x" style={{ left: guides.x }} aria-hidden="true" />}
      {guides.y !== null && <div className="dt-guide dt-guide-y" style={{ top: guides.y }} aria-hidden="true" />}
      {guides.slot && (
        <div
          className="dt-slot"
          style={{ left: guides.slot.left, top: guides.slot.top, width: guides.slot.w, height: guides.slot.h }}
          aria-hidden="true"
        />
      )}
      <div className="dt-toolbar" role="toolbar" aria-label="Edit Widgets">
        <span className="dt-toolbar-title">Edit Widgets</span>
        <span className="dt-toolbar-hint">Drag to arrange · drag a corner or right-click to resize</span>
        {hidden.map((id) => (
          <button key={id} type="button" className="dt-btn" onClick={() => showOnDesktop(id)}>
            + {ITEMS[id].label}
          </button>
        ))}
        <button
          type="button"
          className="dt-btn"
          onClick={() => {
            setEditing(false);
            window.dispatchEvent(new CustomEvent('settings:open', { detail: { tab: 'widgets' } }));
          }}
        >
          Widgets…
        </button>
        <button type="button" className="dt-btn" onClick={resetLayout}>Reset</button>
        <button type="button" className="dt-btn dt-btn-primary" onClick={() => setEditing(false)}>Done</button>
      </div>
    </>
  );
}
