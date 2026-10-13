import { useRef } from 'react';
import { ACCEPTED_LOCAL_TYPES } from '../../libs/wallpaper/imageLoader';
import { plural } from './wallpaperUi';

function ImportSummary({ summary, onDismiss }) {
  const { imported, duplicates, failed, cancelled } = summary;
  const hasDetails = failed.length > 0 || duplicates.length > 0;
  const tone = failed.length > 0 ? 'warning' : 'success';

  return (
    <div className={`wp-summary is-${tone}`}>
      <div className="wp-summary-head">
        <span className="wp-summary-text">
          {imported.length} imported · {plural(duplicates.length, 'duplicate')} · {failed.length} failed
          {cancelled && ' · cancelled'}
        </span>
        <button type="button" className="wp-link-btn" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      {hasDetails && (
        <details className="wp-summary-details">
          <summary>Show details</summary>
          {failed.length > 0 && (
            <>
              <h4>Failed</h4>
              <ul className="wp-detail-list">
                {failed.map((f, i) => (
                  <li key={`${f.name}-${i}`}>
                    <span className="wp-detail-name">{f.name}</span>
                    <span className="wp-detail-reason">{f.reason}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {duplicates.length > 0 && (
            <>
              <h4>Already in your library</h4>
              <ul className="wp-detail-list">
                {duplicates.map((name, i) => (
                  <li key={`${name}-${i}`}>
                    <span className="wp-detail-name">{name}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </details>
      )}
    </div>
  );
}

export default function LocalImportPanel({ importState, onImport, onCancel, onDismissSummary }) {
  const inputRef = useRef(null);
  const { running, cancelling, progress, summary, error } = importState;
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length > 0) onImport(files);
  };

  return (
    <div className="wp-panel">
      <div className="settings-group-card-title">Local Images</div>
      <div className="settings-group-card">
        <div className="settings-row wp-row-wrap">
          <div className="wp-row-text">
            <span className="settings-label">Import images</span>
            <span className="wp-hint">JPEG, PNG or GIF, up to 25 MB each. You can also drop files onto the library below.</span>
          </div>
          <button
            type="button"
            className="settings-btn settings-btn-primary"
            onClick={() => inputRef.current?.click()}
            disabled={running}
          >
            {running ? 'Importing…' : 'Choose Images…'}
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED_LOCAL_TYPES.join(',')}
            className="wp-hidden-input"
            tabIndex={-1}
            aria-hidden="true"
            onChange={handleFileChange}
          />
        </div>

        {running && (
          <div className="settings-row wp-progress-row">
            <div className="wp-progress-body">
              <div
                className="wp-progress"
                role="progressbar"
                aria-label="Import progress"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.done}
              >
                <div className="wp-progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <span className="wp-progress-meta">
                {cancelling
                  ? 'Cancelling…'
                  : `${progress.done} of ${progress.total}${progress.current ? ` · ${progress.current}` : ''}`}
              </span>
            </div>
            <button
              type="button"
              className="settings-btn settings-btn-secondary"
              onClick={onCancel}
              disabled={cancelling}
            >
              Cancel
            </button>
          </div>
        )}

        {!running && error && (
          <div className="settings-row">
            <p className="wp-notice is-error">{error}</p>
          </div>
        )}

        {!running && summary && (
          <div className="settings-row">
            <ImportSummary summary={summary} onDismiss={onDismissSummary} />
          </div>
        )}
      </div>
    </div>
  );
}
