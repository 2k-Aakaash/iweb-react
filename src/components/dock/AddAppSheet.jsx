import { useEffect, useRef, useState } from 'react';
import GlassSurface from '../glass/GlassSurface';
import '../../styles/mac-alert.css';

// Add App, as a macOS 26 sheet: the alert card (mac-alert.css) with a name and an address.
// `onAdd({ name, url })` returns an error sentence to show under the fields, or null when it
// was added. Enter adds, Escape cancels.

const IWEB_ICON = 'https://ik.imagekit.io/026k2i7ys/iWeb%20Favicon.svg?updatedAt=1700227200100';

export default function AddAppSheet({ onAdd, onClose }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const nameRef = useRef(null);

  useEffect(() => {
    nameRef.current?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const submit = (e) => {
    e.preventDefault();
    const message = onAdd({ name, url });
    if (message) setError(message);
  };

  return (
    <div className="ma-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="ma-card ma-sheet glass-host" role="dialog" aria-modal="true" aria-labelledby="add-app-title" onSubmit={submit}>
        <GlassSurface preset="window" />
        <img className="ma-icon" src={IWEB_ICON} alt="" draggable={false} />
        <h2 id="add-app-title" className="ma-title">Add App</h2>
        <p className="ma-message">Put a website in the Dock and in Apps.</p>
        <div className="ma-fields">
          <input
            ref={nameRef}
            className="ma-field"
            aria-label="Name"
            placeholder="Name (e.g. Reddit)"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
          />
          <input
            className="ma-field"
            aria-label="Address"
            placeholder="Address (e.g. reddit.com)"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(''); }}
          />
          {error && <p className="ma-error" role="alert">{error}</p>}
        </div>
        <div className="ma-buttons is-two">
          <button type="button" className="ma-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="ma-btn is-main" disabled={!name.trim() || !url.trim()}>Add</button>
        </div>
      </form>
    </div>
  );
}
