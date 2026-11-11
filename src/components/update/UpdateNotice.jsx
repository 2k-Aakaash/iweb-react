import { useEffect, useState } from 'react';
import { checkForUpdate, dismissUpdate, getUpdateMode, isDismissed } from '../../libs/updater/updater';
import { notifyOnce } from '../../libs/notifications/notifications';
import '../../styles/update.css';

// Small new-tab notice when a newer extension release exists. Uses the cached
// check (at most one GitHub request every 6 hours across all tabs).
export default function UpdateNotice() {
  const [latest, setLatest] = useState(null);

  useEffect(() => {
    if (getUpdateMode() !== 'release') return undefined;
    let cancelled = false;
    checkForUpdate()
      .then((status) => {
        if (!cancelled && status.available && !isDismissed(status.latest.tag)) {
          setLatest(status.latest);
          // Also in Notification Center, once per release.
          notifyOnce(`update:${status.latest.tag}`, {
            app: 'update',
            title: 'Software Update',
            body: `iWeb ${status.latest.tag} is available.`,
            action: { event: 'settings:open', detail: { tab: 'about' } },
          });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!latest) return null;

  const openAbout = () => {
    window.dispatchEvent(new CustomEvent('settings:open', { detail: { tab: 'about' } }));
    setLatest(null);
  };

  const dismiss = () => {
    dismissUpdate(latest.tag);
    setLatest(null);
  };

  return (
    <div className="iu-notice" role="status">
      <span className="iu-dot iu-dot-new" aria-hidden="true" />
      <span className="iu-notice-text">iWeb update available <span className="iu-notice-tag">{latest.tag}</span></span>
      <button type="button" className="iu-notice-btn iu-notice-primary" onClick={openAbout}>Update</button>
      <button type="button" className="iu-notice-btn" onClick={dismiss} aria-label="Dismiss update notice">✕</button>
    </div>
  );
}
