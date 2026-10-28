import { useEffect, useState } from 'react';
import SoftwareUpdate from '../update/SoftwareUpdate';
import { CURRENT_TAG, getUpdateMode, parseBuildNumber, parseVersion } from '../../libs/updater/updater';
import { formatBytes, getDeviceInfo } from '../../libs/about/deviceInfo';
import '../../styles/settings-about.css';

// Settings → About, after macOS 26 Settings → General → About: a picture of the display (with
// the current wallpaper on it) and the machine's name, then grouped rows of label and value,
// and sections for iWeb, Displays, Storage and Software Update.

const IWEB_ICON = 'https://ik.imagekit.io/026k2i7ys/iWeb%20Favicon.svg?updatedAt=1700227200100';

const EDITIONS = { web: 'Website', release: 'Chrome Extension', dev: 'Chrome Extension (local build)' };

function versionText() {
  const version = parseVersion(CURRENT_TAG);
  if (!version) return 'Local build';
  const [major, minor, patch] = version;
  const build = parseBuildNumber(CURRENT_TAG);
  return `Version ${major}.${minor}${patch ? `.${patch}` : ''}${build ? ` (build ${build})` : ''}`;
}

// Small macOS-style tiles for section rows (original artwork).
function RowTile({ from, to, children }) {
  return (
    <span className="about-row-tile" style={{ background: `linear-gradient(${from}, ${to})` }} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  );
}

function Row({ label, value, icon }) {
  return (
    <div className="settings-row about-row">
      <span className="settings-label about-row-label">{icon}{label}</span>
      <span className="settings-value">{value}</span>
    </div>
  );
}

export default function AboutPane({ customName }) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getDeviceInfo().then((result) => {
      if (!cancelled) setInfo(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const name = customName ? `${customName}’s iWeb` : 'iWeb';
  const memory = info?.memoryGB ? `${info.memoryGB >= 8 ? '8 GB or more' : `${info.memoryGB} GB`}` : '—';
  const display = info?.display
    ? `${info.display.width} × ${info.display.height}${info.display.scale !== 1 ? ` · ${+info.display.scale.toFixed(2)}×` : ''}`
    : '—';
  const storage = info?.storage;

  return (
    <div className="settings-tab-pane about-pane">
      <div className="about-hero">
        <div className="about-monitor" aria-hidden="true">
          <div className="about-monitor-screen" />
          <div className="about-monitor-neck" />
          <div className="about-monitor-foot" />
        </div>
        <h3 className="about-name">{name}</h3>
      </div>

      <div className="settings-group-card">
        <Row label="Name" value={name} />
        <Row label="Browser" value={info ? `${info.browser.name} ${info.browser.version}`.trim() : '—'} />
        <Row label="System" value={info?.os || '—'} />
        <Row label="Processor" value={info?.cores ? `${info.cores} cores` : '—'} />
        <Row label="Memory" value={memory} />
      </div>

      <div className="settings-group-card-title">iWeb</div>
      <div className="settings-group-card">
        <Row
          icon={<img className="about-row-tile about-row-app" src={IWEB_ICON} alt="" />}
          label="iWeb"
          value={versionText()}
        />
        <Row label="Edition" value={EDITIONS[getUpdateMode()]} />
        <Row label="Developer" value="2K Aakaash" />
        <Row label="Built with" value="React · Vite" />
      </div>

      <div className="settings-group-card-title">Displays</div>
      <div className="settings-group-card">
        <Row
          icon={(
            <RowTile from="#5aaeff" to="#0a64eb">
              <rect x="3.5" y="5" width="17" height="11" rx="1.5" />
              <path d="M9 19.5h6M12 16v3.5" />
            </RowTile>
          )}
          label="This Display"
          value={display}
        />
      </div>

      <div className="settings-group-card-title">Storage</div>
      <div className="settings-group-card">
        <Row
          icon={(
            <RowTile from="#a3a6ad" to="#6c6f77">
              <rect x="3.5" y="7" width="17" height="10" rx="2" />
              <path d="M7 14h.01M10.5 14h6" />
            </RowTile>
          )}
          label="iWeb Data"
          value={storage
            ? `${formatBytes(storage.used)} used${storage.quota ? ` · ${formatBytes(Math.max(0, storage.quota - storage.used))} available` : ''}`
            : '—'}
        />
      </div>

      <div className="settings-group-card-title">Software Update</div>
      <SoftwareUpdate />

      <p className="about-footer">© {new Date().getFullYear()} 2K Aakaash. All data stays in this browser.</p>
    </div>
  );
}
