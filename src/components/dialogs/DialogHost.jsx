import { useEffect, useRef } from 'react';
import GlassSurface from '../glass/GlassSurface';
import { answer, useFrontDialog } from '../../libs/dialogs/dialogs';
import '../../styles/mac-alert.css';

// The macOS 26 alert (libs/dialogs/dialogs.js): the app icon, a bold title, the message and
// capsule buttons, centred over a light dim. Enter presses the main button, Escape cancels;
// keys go to it before anything else on the page.

const IWEB_ICON = 'https://ik.imagekit.io/026k2i7ys/iWeb%20Favicon.svg?updatedAt=1700227200100';

export default function DialogHost() {
  const dialog = useFrontDialog();
  const mainRef = useRef(null);

  useEffect(() => {
    if (!dialog) return undefined;
    const before = document.activeElement;
    mainRef.current?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        answer(false);
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        e.stopPropagation();
        answer(true);
      } else if (e.key === 'Tab') {
        // Focus stays in the alert.
        const buttons = [...document.querySelectorAll('.ma-card button')];
        if (!buttons.length) return;
        e.preventDefault();
        const i = buttons.indexOf(document.activeElement);
        buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (before instanceof HTMLElement && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [dialog]);

  if (!dialog) return null;
  const titleId = `ma-title-${dialog.id}`;
  const messageId = `ma-message-${dialog.id}`;
  return (
    <div className="ma-overlay" onPointerDown={(e) => e.stopPropagation()}>
      <div
        key={dialog.id}
        className="ma-card glass-host"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={dialog.message ? messageId : undefined}
      >
        <GlassSurface preset="window" />
        <img className="ma-icon" src={IWEB_ICON} alt="" draggable={false} />
        <h2 id={titleId} className="ma-title">{dialog.title}</h2>
        {dialog.message && <p id={messageId} className="ma-message">{dialog.message}</p>}
        <div className={`ma-buttons${dialog.kind === 'confirm' ? ' is-two' : ''}`}>
          {dialog.kind === 'confirm' && (
            <button type="button" className="ma-btn" onClick={() => answer(false)}>{dialog.cancelLabel}</button>
          )}
          <button
            ref={mainRef}
            type="button"
            className={`ma-btn is-main${dialog.destructive ? ' is-destructive' : ''}`}
            onClick={() => answer(true)}
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
