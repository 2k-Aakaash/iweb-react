import { useRef, useState } from 'react';
import { exportToIwebBackup } from '../../libs/backupService';
import SettingsTabIcon from './SettingsTabIcon';
import '../../styles/settings-data.css';

// Settings → Data Controls, after macOS 26's Time Machine pane: a header with the latest
// backup, the data to include as rows with switches, Back Up Now, and Restore. Restoring
// asks for confirmation in SettingsModal (onImportFile).

const LAST_BACKUP_KEY = 'iweb:lastBackupAt';

const MODULES = [
  { id: 'images', icon: 'wallpaper', title: 'Wallpapers', detail: 'Images and GIFs you imported.' },
  { id: 'bookmarks', icon: 'bookmarks', title: 'Bookmarks', detail: 'Dock and browser bookmarks, folders and icons.' },
  { id: 'music', icon: 'music', title: 'Music', detail: 'Library folder, playlists and favourites.' },
  { id: 'notes', icon: 'notes', title: 'Notes', detail: 'All your notes.' },
];

function readLastBackup() {
  try {
    const value = Number(localStorage.getItem(LAST_BACKUP_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** "Today at 3:21 PM", "Yesterday at …", "14 Oct 2026 at …". */
function describeWhen(t) {
  const date = new Date(t);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = new Date(t).setHours(0, 0, 0, 0);
  const today = new Date().setHours(0, 0, 0, 0);
  if (day === today) return `Today at ${time}`;
  if (day === today - 86400000) return `Yesterday at ${time}`;
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} at ${time}`;
}

export default function DataControlsPane({ onImportFile }) {
  const [modules, setModules] = useState({ images: true, bookmarks: true, music: true, notes: true });
  const [lastBackup, setLastBackup] = useState(readLastBackup);
  const [status, setStatus] = useState(null); // { tone: 'busy' | 'ok' | 'error', text }
  const fileRef = useRef(null);

  const selectedCount = Object.values(modules).filter(Boolean).length;
  const busy = status?.tone === 'busy';

  const handleBackUp = async () => {
    if (busy || selectedCount === 0) return;
    setStatus({ tone: 'busy', text: 'Backing up…' });
    try {
      await exportToIwebBackup(modules);
      const now = Date.now();
      try {
        localStorage.setItem(LAST_BACKUP_KEY, String(now));
      } catch {
        // Storage full or blocked: the backup file was still saved.
      }
      setLastBackup(now);
      setStatus({ tone: 'ok', text: 'Backup downloaded as backup.iwebbackup.' });
    } catch (err) {
      setStatus({ tone: 'error', text: `Backup failed: ${err?.message || 'unknown error'}` });
    }
  };

  return (
    <div className="settings-tab-pane dc-pane">
      <div className="settings-group-card dc-hero">
        <SettingsTabIcon id="data_controls" className="dc-hero-icon" />
        <div className="dc-hero-text">
          <h3>Back Up iWeb</h3>
          <p>Save your wallpapers, bookmarks, music and notes to a backup file, then restore it in any browser.</p>
          <span className="dc-hero-meta">
            {lastBackup ? `Latest backup: ${describeWhen(lastBackup)}` : 'No backups yet'}
          </span>
        </div>
      </div>

      <div className="settings-group-card-title">Include in Backup</div>
      <div className="settings-group-card">
        {MODULES.map((module) => (
          <label key={module.id} className="settings-row dc-row">
            <SettingsTabIcon id={module.icon} className="dc-row-icon" />
            <span className="dc-row-text">
              <span className="dc-row-title">{module.title}</span>
              <span className="dc-row-detail">{module.detail}</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="settings-switch"
              checked={modules[module.id]}
              disabled={busy}
              onChange={(e) => setModules((prev) => ({ ...prev, [module.id]: e.target.checked }))}
            />
          </label>
        ))}
        <div className="settings-row dc-actions">
          <span className={`dc-status${status ? ` is-${status.tone}` : ''}`} role="status" aria-live="polite">
            {status?.text || (selectedCount === 0 ? 'Turn on at least one item to back up.' : '')}
          </span>
          <button
            type="button"
            className="settings-btn settings-btn-primary"
            onClick={handleBackUp}
            disabled={busy || selectedCount === 0}
          >
            {busy ? 'Backing Up…' : 'Back Up Now'}
          </button>
        </div>
      </div>

      <div className="settings-group-card-title">Restore</div>
      <div className="settings-group-card">
        <div className="settings-row dc-row">
          <SettingsTabIcon id="restore" className="dc-row-icon" />
          <span className="dc-row-text">
            <span className="dc-row-title">Restore from Backup</span>
            <span className="dc-row-detail">Replaces data in this browser with a .iwebbackup file. You choose what to restore.</span>
          </span>
          <button type="button" className="settings-btn settings-btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
            Choose Backup…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".iwebbackup,.zip"
            hidden
            onChange={onImportFile}
          />
        </div>
      </div>
    </div>
  );
}
