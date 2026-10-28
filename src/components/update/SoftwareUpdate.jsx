import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CURRENT_TAG,
  applyUpdate,
  canWriteFolder,
  checkForUpdate,
  chooseExtensionFolder,
  getSavedFolderName,
  getUpdateMode,
} from '../../libs/updater/updater';
import '../../styles/update.css';

const PHASE_TEXT = {
  permission: 'Waiting for folder access…',
  download: 'Downloading update…',
  verify: 'Verifying download…',
  write: 'Installing files…',
  cleanup: 'Removing old files…',
  reload: 'Restarting iWeb…',
};

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

// About → Software Update: shows the installed/latest release and installs updates
// into the unpacked extension folder.
export default function SoftwareUpdate() {
  const mode = getUpdateMode();
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [folderName, setFolderName] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const busyRef = useRef(false);

  const runCheck = useCallback(async (force) => {
    setChecking(true);
    setError('');
    try {
      setStatus(await checkForUpdate({ force }));
    } catch (err) {
      setError(err?.message || 'Update check failed.');
    } finally {
      setChecking(false);
    }
  }, []);

  // Initial (cached) check; state is only set from async callbacks.
  useEffect(() => {
    if (mode !== 'release') return undefined;
    let cancelled = false;
    checkForUpdate()
      .then((result) => { if (!cancelled) setStatus(result); })
      .catch((err) => { if (!cancelled) setError(err?.message || 'Update check failed.'); });
    getSavedFolderName()
      .then((name) => { if (!cancelled) setFolderName(name); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [mode]);

  const handleChooseFolder = async () => {
    setError('');
    try {
      setFolderName(await chooseExtensionFolder());
    } catch (err) {
      if (err?.code !== 'CANCELLED') setError(err?.message || 'Couldn’t use that folder.');
    }
  };

  // Update Now is always clickable: without a remembered folder it asks for one first (the
  // picker grants write access, so the install continues in the same click). It used to be
  // silently disabled until "Choose Folder", which looked like a button that did nothing.
  const handleUpdate = async () => {
    if (busyRef.current || !status?.latest) return;
    busyRef.current = true;
    setError('');
    try {
      if (!folderName) {
        try {
          setFolderName(await chooseExtensionFolder());
        } catch (err) {
          if (err?.code === 'CANCELLED') return;
          throw err;
        }
      }
      await applyUpdate(status.latest, { onProgress: setProgress });
    } catch (err) {
      setProgress(null);
      setError(err?.message || 'The update failed. Your current version is unchanged.');
      if (err?.code === 'NO_FOLDER' || err?.code === 'WRONG_FOLDER') setFolderName(null);
    } finally {
      busyRef.current = false;
    }
  };

  if (mode === 'web') {
    return (
      <div className="settings-group-card iu-card">
        <div className="settings-row">
          <span className="settings-label">Software Update</span>
          <span className="settings-value">The web version updates automatically.</span>
        </div>
      </div>
    );
  }

  if (mode === 'dev') {
    return (
      <div className="settings-group-card iu-card">
        <div className="settings-row">
          <span className="settings-label">Software Update</span>
          <span className="settings-value">Local development build — updates are off.</span>
        </div>
      </div>
    );
  }

  const latest = status?.latest;
  const available = Boolean(status?.available);
  const installing = Boolean(progress);
  const writeShare = progress?.phase === 'write' && progress.total ? Math.round((progress.done / progress.total) * 100) : null;

  return (
    <div className="settings-group-card iu-card">
      <div className="settings-row">
        <span className="settings-label">Installed</span>
        <span className="settings-value">{CURRENT_TAG}</span>
      </div>
      <div className="settings-row">
        <span className="settings-label">Latest release</span>
        <span className="settings-value">
          {checking && !latest ? 'Checking…' : latest ? latest.tag : '—'}
        </span>
      </div>

      <div className="iu-status" role="status" aria-live="polite">
        {installing ? (
          <>
            <span className="iu-dot iu-dot-busy" aria-hidden="true" />
            {PHASE_TEXT[progress.phase]}{writeShare !== null ? ` ${writeShare}%` : ''}
          </>
        ) : available ? (
          <>
            <span className="iu-dot iu-dot-new" aria-hidden="true" />
            {latest.tag} is available{latest.publishedAt ? ` · released ${formatDate(latest.publishedAt)}` : ''}.{' '}
            <a href={latest.url} target="_blank" rel="noopener noreferrer">Release notes</a>
          </>
        ) : latest ? (
          <>
            <span className="iu-dot iu-dot-ok" aria-hidden="true" />
            iWeb is up to date.
          </>
        ) : null}
        {error && <span className="iu-error">{error}</span>}
      </div>

      {available && canWriteFolder() && (
        <div className="iu-folder">
          <span className="settings-value">
            {folderName
              ? <>Extension folder: <strong>{folderName}</strong></>
              : 'Update Now will ask for the folder you loaded in chrome://extensions → Load unpacked (the one with manifest.json).'}
          </span>
          <button type="button" className="settings-btn" onClick={handleChooseFolder} disabled={installing}>
            {folderName ? 'Change Folder' : 'Choose Folder'}
          </button>
        </div>
      )}

      {available && !canWriteFolder() && (
        <p className="iu-hint">
          This browser can’t install updates automatically. Download iWeb.Extension.zip from the{' '}
          <a href={latest.url} target="_blank" rel="noopener noreferrer">release page</a>, unzip it over your extension
          folder, then click reload in chrome://extensions.
        </p>
      )}

      <div className="iu-actions">
        <button type="button" className="settings-btn" onClick={() => runCheck(true)} disabled={checking || installing}>
          {checking ? 'Checking…' : 'Check for Updates'}
        </button>
        {available && canWriteFolder() && (
          <button
            type="button"
            className="settings-btn settings-btn-primary"
            onClick={handleUpdate}
            disabled={installing}
          >
            {installing ? 'Updating…' : 'Update Now'}
          </button>
        )}
      </div>
    </div>
  );
}
