import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import GlassSurface from '../glass/GlassSurface';
import { updateItem } from '../../libs/desktop/layoutStore';
import { openGalleryOn } from '../../libs/desktop/galleryFocus';
import { NEEDS_ACTION } from '../../libs/creator/creatorApi';
import { formatAgo } from '../../libs/creator/creatorFormat';
import { loadConfig, refreshAccount } from '../../libs/creator/creatorStore';
import { selectAccount } from '../../libs/creator/creatorPrefs';
import '../../styles/creator.css';

// The Creator widget's shell (YouTubeWidget): who the account
// is, its metrics, when they were last updated, and the controls (refresh, switch account,
// manage). Sizes: small (one headline number), medium (four metrics; Details flips to the
// rest in place) and large (both). A refresh that fails keeps the numbers on screen and
// says so in the footer; missing metrics say why instead of showing 0.
//
// metric: { id, label, value (text) | null, title?, change?: { text, dir, title }, missing? }

function Avatar({ profile, glyph }) {
  const [broken, setBroken] = useState(false);
  if (profile?.avatar && !broken) {
    return <img className="crw-avatar" src={profile.avatar} alt="" draggable={false} referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return <span className="crw-avatar crw-avatar-glyph" aria-hidden="true">{glyph}</span>;
}

function Metric({ metric, big = false }) {
  return (
    <div className={`crw-metric${big ? ' is-big' : ''}`} title={metric.title || undefined}>
      <span className="crw-metric-label">{metric.label}</span>
      {metric.value !== null ? (
        <span className="crw-metric-value">{metric.value}</span>
      ) : (
        <span className="crw-metric-value is-missing">—</span>
      )}
      {metric.value === null && metric.missing ? (
        <span className="crw-metric-note">{metric.missing}</span>
      ) : metric.change ? (
        <span className={`crw-metric-change is-${metric.change.dir}`} title={metric.change.title}>{metric.change.text}</span>
      ) : metric.note ? (
        <span className="crw-metric-note">{metric.note}</span>
      ) : null}
    </div>
  );
}

const RefreshIcon = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M13.2 6.2A5.4 5.4 0 0 0 3.1 5" />
    <path d="M2.8 9.8A5.4 5.4 0 0 0 12.9 11" />
    <path d="M13.4 2.6v3.6H9.8M2.6 13.4V9.8h3.6" />
  </svg>
);

const MoreIcon = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
    <circle cx="3.5" cy="8" r="1.4" />
    <circle cx="8" cy="8" r="1.4" />
    <circle cx="12.5" cy="8" r="1.4" />
  </svg>
);

// The ⋯ menu: switch account, refresh, details, manage, remove (the desktop menu's look).
function WidgetMenu({ anchor, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const left = Math.min(Math.max(8, a.right - r.width), window.innerWidth - r.width - 8);
    const top = a.bottom + 6 + r.height > window.innerHeight - 8 ? Math.max(8, a.top - r.height - 6) : a.bottom + 6;
    setPos({ left, top });
    el.querySelector('[role^="menuitem"]')?.focus({ preventScroll: true });
  }, [anchor]);
  useEffect(() => {
    const onDown = (e) => {
      if (!ref.current?.contains(e.target) && !anchor?.contains(e.target)) onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [anchor, onClose]);
  const onKeyDown = (e) => {
    const list = [...ref.current.querySelectorAll('[role^="menuitem"]')];
    const i = list.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      anchor?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
    }
  };
  return createPortal(
    <div ref={ref} className={`dt-menu crw-menu${pos ? ' is-placed' : ''}`} role="menu" style={pos || { left: -9999, top: 0 }} onKeyDown={onKeyDown}>
      {items.map((item, i) => {
        if (item.type === 'separator') return <div key={i} className="dt-menu-sep" role="separator" />;
        if (item.type === 'header') return <div key={i} className="dt-menu-header">{item.label}</div>;
        const radio = item.checked !== undefined;
        return (
          <button
            key={i}
            type="button"
            className="dt-menu-item"
            role={radio ? 'menuitemradio' : 'menuitem'}
            aria-checked={radio ? item.checked : undefined}
            tabIndex={-1}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span className="dt-menu-check" aria-hidden="true">{item.checked ? '✓' : ''}</span>
            <span className="dt-menu-label">{item.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

// Keeps "5 min ago" current while on screen.
function useNow(enabled) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

function statusOf(account, refreshing, now) {
  if (refreshing) return { text: 'Updating…', tone: 'busy' };
  const ago = formatAgo(account.fetchedAt, now);
  if (account.error) {
    const needsAction = NEEDS_ACTION.has(account.error.code);
    return {
      text: needsAction ? 'Action needed' : ago ? `Not updated · ${ago.toLowerCase()}` : 'Couldn’t update',
      tone: needsAction ? 'action' : 'stale',
      title: account.error.message,
      needsAction,
    };
  }
  return { text: ago ? `Updated ${ago.toLowerCase()}` : '', tone: 'ok' };
}

export default function CreatorWidget({
  id, // 'youtube'
  title,
  glyph,
  size = 'medium',
  view, // useWidgetAccount()
  config,
  badge, // mode/account type, e.g. "Public stats"
  primary = [],
  details = [],
  extra = null, // large size: chart, recent posts
  empty, // { message, action } when there's no account
}) {
  const { account, accounts, refreshing } = view;
  const [page, setPage] = useState('primary'); // medium: 'primary' | 'details'
  const [menuAnchor, setMenuAnchor] = useState(null);
  const now = useNow(Boolean(account));
  const status = account ? statusOf(account, refreshing, now) : null;
  const hasData = Boolean(account?.data);
  const manage = () => openGalleryOn(id);

  const menuItems = [
    ...(accounts.length > 1
      ? [{ type: 'header', label: 'Show' }, ...accounts.map((a) => ({
        label: `${a.profile?.name || a.ref}${a.profile?.handle ? ` (${a.profile.handle})` : ''}`,
        checked: a.id === account?.id,
        onSelect: () => selectAccount(id, a.id),
      })), { type: 'separator' }]
      : []),
    ...(account ? [{ label: 'Refresh Now', onSelect: () => refreshAccount(account.id, { force: true }) }] : []),
    ...(account && size === 'medium' && details.length ? [{ label: page === 'details' ? 'Show Summary' : 'Show Details', onSelect: () => setPage(page === 'details' ? 'primary' : 'details') }] : []),
    { label: 'Manage Accounts…', onSelect: manage },
    { type: 'separator' },
    { label: 'Remove Widget', onSelect: () => updateItem(id, { hidden: true }) },
  ];

  let body;
  if (!view.ready || (!account && !config)) {
    body = (
      <div className="crw-body crw-loading" aria-hidden="true">
        <span className="cw-shimmer crw-shimmer-line" />
        <span className="cw-shimmer crw-shimmer-value" />
        <span className="cw-shimmer crw-shimmer-line is-short" />
      </div>
    );
  } else if (!account) {
    body = (
      <div className="crw-body crw-empty">
        <p>{empty.message}</p>
        {empty.action && <button type="button" className="crw-action" onClick={empty.action.onClick || manage}>{empty.action.label}</button>}
      </div>
    );
  } else if (!hasData) {
    body = (
      <div className="crw-body crw-empty" role={account.error ? 'alert' : undefined}>
        {account.error ? <p>{account.error.message}</p> : <p>Loading…</p>}
        {account.error && (
          <button type="button" className="crw-action" onClick={status.needsAction ? manage : () => refreshAccount(account.id, { force: true })}>
            {status.needsAction ? 'Fix in Settings' : 'Try Again'}
          </button>
        )}
      </div>
    );
  } else if (size === 'small') {
    body = <div className="crw-body"><Metric metric={primary[0]} big /></div>;
  } else {
    const showDetails = size === 'medium' && page === 'details';
    const grid = showDetails ? details : primary;
    body = (
      <div className="crw-body">
        <div className="crw-grid" aria-live="off">
          {grid.slice(0, 4).map((m) => <Metric key={m.id} metric={m} />)}
        </div>
        {size === 'large' && details.length > 0 && (
          <div className="crw-details">
            {details.map((m) => (
              <div key={m.id} className="crw-row" title={m.title || undefined}>
                <span className="crw-row-label">{m.label}</span>
                <span className={`crw-row-value${m.value === null ? ' is-missing' : ''}`}>{m.value ?? m.missing ?? '—'}</span>
              </div>
            ))}
          </div>
        )}
        {size === 'large' && extra}
      </div>
    );
  }

  const label = account
    ? `${title}: ${account.profile?.name || ''}${status?.text ? `. ${status.text}` : ''}`
    : title;

  return (
    <section className={`crw-card crw-${id} crw-${size} glass-host`} aria-label={label}>
      <GlassSurface preset="card" />
      <header className="crw-head">
        {account ? <Avatar profile={account.profile} glyph={glyph} /> : <span className="crw-avatar crw-avatar-glyph" aria-hidden="true">{glyph}</span>}
        <div className="crw-who">
          <span className="crw-name">{account?.profile?.name || title}</span>
          {size !== 'small' && (
            <span className="crw-sub">
              {account?.profile?.handle && <span className="crw-handle">{account.profile.handle}</span>}
              {account && badge && <span className="crw-badge">{badge}</span>}
              {!account && <span className="crw-handle">Creator Widgets</span>}
            </span>
          )}
        </div>
        <div className="crw-tools">
          {account && size !== 'small' && (
            <button
              type="button"
              className={`crw-tool${refreshing ? ' is-spinning' : ''}`}
              onClick={() => refreshAccount(account.id, { force: true })}
              disabled={refreshing}
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshIcon />
            </button>
          )}
          <button
            type="button"
            className="crw-tool"
            aria-label={`${title} options`}
            title="Options"
            aria-haspopup="menu"
            aria-expanded={Boolean(menuAnchor)}
            onClick={(e) => setMenuAnchor(menuAnchor ? null : e.currentTarget)}
          >
            <MoreIcon />
          </button>
        </div>
      </header>

      {body}

      {account && hasData && status && (
        <footer className={`crw-foot is-${status.tone}`} title={status.title}>
          <span className="crw-foot-dot" aria-hidden="true" />
          <span className="crw-foot-text" role={status.tone === 'stale' || status.tone === 'action' ? 'status' : undefined}>{status.text}</span>
          {size === 'medium' && details.length > 0 && status.tone !== 'action' && (
            <button type="button" className="crw-link" onClick={() => setPage(page === 'details' ? 'primary' : 'details')} aria-pressed={page === 'details'}>
              {page === 'details' ? 'Summary' : 'Details'}
            </button>
          )}
          {status.tone === 'stale' && size !== 'medium' && (
            <button type="button" className="crw-link" onClick={() => refreshAccount(account.id, { force: true })}>Retry</button>
          )}
          {status.needsAction && <button type="button" className="crw-link" onClick={manage}>Fix</button>}
        </footer>
      )}
      {!account && view.ready && config?.error && (
        <footer className="crw-foot is-stale">
          <span className="crw-foot-dot" aria-hidden="true" />
          <span className="crw-foot-text">Can’t reach iWeb’s server</span>
          <button type="button" className="crw-link" onClick={() => loadConfig({ force: true })}>Retry</button>
        </footer>
      )}

      {menuAnchor && <WidgetMenu anchor={menuAnchor} items={menuItems} onClose={() => setMenuAnchor(null)} />}
    </section>
  );
}
