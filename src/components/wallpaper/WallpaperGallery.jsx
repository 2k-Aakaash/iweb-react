import { useRef, useState } from 'react';
import SegmentedControl from './SegmentedControl';
import WallpaperThumb from './WallpaperThumb';
import Attribution from './Attribution';

const SOURCE_LABELS = { local: 'Local', unsplash: 'Unsplash' };

const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

// macOS 26-style round glass button (arrow into a tray), shown over the photo on hover.
function DownloadButton({ item, busy, onDownload }) {
  return (
    <button
      type="button"
      className={`wp-card-download${busy ? ' is-busy' : ''}`}
      aria-label={`Download ${item.title}`}
      title="Download"
      disabled={busy}
      onClick={() => onDownload(item)}
    >
      {busy ? (
        <span className="wp-spinner wp-spinner-inline" aria-hidden="true" />
      ) : (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 4v10.5M7.5 10.5 12 15l4.5-4.5" />
          <path d="M5 15.5v2A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-2" />
        </svg>
      )}
    </button>
  );
}

function WallpaperCard({ item, isActive, selectionMode, selected, disabled, downloading, onClick, onDownload }) {
  const sourceLabel = SOURCE_LABELS[item.source];
  const description = `${sourceLabel} wallpaper: ${item.title}`;
  const label = selectionMode
    ? `${selected ? 'Deselect' : 'Select'} ${description}`
    : `${description}${isActive ? ' (active)' : ''}`;

  return (
    <li className={`wp-card ${isActive ? 'is-active' : ''} ${selected ? 'is-selected' : ''}`}>
      <button
        type="button"
        className="wp-card-button"
        aria-pressed={selectionMode ? selected : isActive}
        aria-label={label}
        title={item.title}
        disabled={disabled}
        onClick={() => onClick(item)}
      >
        <WallpaperThumb blob={item.thumbBlob} url={item.thumbUrl} color={item.color} />
        <span className={`wp-badge wp-badge-source wp-badge-${item.source}`}>{sourceLabel}</span>
        {isActive && <span className="wp-badge wp-badge-active">Active</span>}
        {selectionMode && (
          <span className={`wp-card-check ${selected ? 'is-checked' : ''}`} aria-hidden="true">
            {selected ? '✓' : ''}
          </span>
        )}
      </button>
      {!selectionMode && onDownload && <DownloadButton item={item} busy={downloading} onDownload={onDownload} />}
      {item.photographer && (
        <Attribution photographer={item.photographer} photoPageUrl={item.photoPageUrl} />
      )}
    </li>
  );
}

export default function WallpaperGallery({
  items,
  counts,
  filter,
  onFilterChange,
  activeKey,
  selectionMode,
  selectedKeys,
  onEnterSelection,
  onExitSelection,
  onSelectAll,
  onClearSelection,
  onRequestDelete,
  onCardClick,
  onDownload,
  downloadingKeys,
  deleting,
  loaded,
  loadError,
  notice,
  dropEnabled,
  onDropFiles
}) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const handleDragEnter = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    if (dropEnabled) setDragging(true);
  };

  const handleDragOver = (e) => {
    if (!hasFiles(e)) return;
    // Always prevent the default so a dropped image never navigates the tab away.
    e.preventDefault();
    e.dataTransfer.dropEffect = dropEnabled ? 'copy' : 'none';
  };

  const handleDragLeave = (e) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  const handleDrop = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!dropEnabled) return;
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) onDropFiles(files);
  };

  const selectedCount = selectedKeys.size;
  const filterOptions = [
    { value: 'all', label: 'All', count: counts.all },
    { value: 'local', label: 'Local', count: counts.local },
    { value: 'unsplash', label: 'Unsplash', count: counts.unsplash }
  ];

  let emptyText = 'No wallpapers yet. Import images or pick a photo from Unsplash.';
  if (filter === 'local') emptyText = 'No local images yet.';
  if (filter === 'unsplash') emptyText = 'No Unsplash photos saved yet.';

  return (
    <section className="wp-gallery" aria-labelledby="wp-gallery-title">
      <div className="wp-section-head">
        <h3 id="wp-gallery-title" className="settings-group-card-title wp-section-title">Library</h3>
        <SegmentedControl
          label="Filter wallpapers"
          size="sm"
          options={filterOptions}
          value={filter}
          onChange={onFilterChange}
          disabled={deleting}
        />
        {!selectionMode && (
          <button
            type="button"
            className="settings-btn settings-btn-secondary wp-select-btn"
            onClick={onEnterSelection}
            disabled={counts.all === 0}
          >
            Select
          </button>
        )}
      </div>

      {selectionMode && (
        <div className="wp-selection-bar" role="toolbar" aria-label="Selection actions">
          <span className="wp-selection-count" aria-live="polite">{selectedCount} selected</span>
          <div className="wp-selection-actions">
            <button type="button" className="settings-btn settings-btn-secondary" onClick={onSelectAll} disabled={deleting || items.length === 0}>
              Select All
            </button>
            <button type="button" className="settings-btn settings-btn-secondary" onClick={onClearSelection} disabled={deleting || selectedCount === 0}>
              Clear
            </button>
            <button type="button" className="settings-btn settings-btn-secondary" onClick={onExitSelection} disabled={deleting}>
              Cancel
            </button>
            <button type="button" className="settings-btn wp-btn-danger" onClick={onRequestDelete} disabled={deleting || selectedCount === 0}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      )}

      {notice && notice.text && (
        <p className={`wp-notice is-${notice.tone}`}>{notice.text}</p>
      )}

      <div
        className={`wp-dropzone ${dropEnabled ? 'is-enabled' : ''} ${dragging ? 'is-dragging' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {loadError ? (
          <p className="wp-empty">{loadError}</p>
        ) : !loaded ? (
          <p className="wp-empty">Loading wallpapers…</p>
        ) : items.length === 0 ? (
          <p className="wp-empty">
            {emptyText}
            {dropEnabled && <span className="wp-empty-hint">Drop JPEG, PNG or GIF files here to import them.</span>}
          </p>
        ) : (
          <ul className="wp-grid" aria-label="Wallpapers">
            {items.map((item) => (
              <WallpaperCard
                key={item.key}
                item={item}
                isActive={item.key === activeKey}
                selectionMode={selectionMode}
                selected={selectedKeys.has(item.key)}
                disabled={deleting}
                downloading={Boolean(downloadingKeys?.has(item.key))}
                onClick={onCardClick}
                onDownload={onDownload}
              />
            ))}
          </ul>
        )}
        {dragging && (
          <div className="wp-drop-overlay" aria-hidden="true">
            <span>Drop images to import</span>
          </div>
        )}
      </div>
    </section>
  );
}
