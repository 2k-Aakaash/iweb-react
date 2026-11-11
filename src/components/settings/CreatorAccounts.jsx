import { useEffect, useRef, useState } from 'react';
import { REFRESH_OPTIONS, selectAccount, setRefreshMinutes, useCreatorPrefs } from '../../libs/creator/creatorPrefs';
import { addPublicChannel, connectAccount, refreshAccount, removeAccount, setAccountCurrency } from '../../libs/creator/creatorStore';
import { useCreatorAccounts, useCreatorConfig, useCreatorState } from '../../libs/creator/useCreator';
import { formatAgo } from '../../libs/creator/creatorFormat';

// Accounts of a Creator widget, in its gallery section (Settings → Widgets): add a public
// YouTube channel, connect a channel with its owner's sign-in,
// choose which one the widget shows, set how often they refresh, and remove them (which
// deletes everything kept for them on this device and, for Google, revokes access).

// Revenue currencies offered (YouTube converts at daily rates); the locale's comes first.
const CURRENCIES = ['USD', 'INR', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'BRL', 'MXN', 'IDR', 'PHP', 'KRW'];
const REGION_CURRENCY = { IN: 'INR', US: 'USD', GB: 'GBP', JP: 'JPY', CA: 'CAD', AU: 'AUD', BR: 'BRL', MX: 'MXN', ID: 'IDR', PH: 'PHP', KR: 'KRW', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR' };

function defaultCurrency() {
  const region = (typeof navigator !== 'undefined' ? navigator.language : '').split('-')[1]?.toUpperCase();
  return REGION_CURRENCY[region] || 'USD';
}

function modeText(account) {
  if (account.mode !== 'owner') return 'Public stats';
  return account.scopes?.revenue ? 'Connected · analytics and revenue' : 'Connected · analytics';
}

function AccountRow({ account, selected, showPick, canConnect, busy, onConnectOwner, now }) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const owner = account.mode === 'owner';
  const remove = async () => {
    setRemoving(true);
    await removeAccount(account.id).catch(() => {});
    setRemoving(false);
  };
  return (
    <li className={`wg-cr-account${selected ? ' is-selected' : ''}`}>
      <div className="wg-cr-account-main">
        {showPick && (
          <input
            type="radio"
            name={`wg-cr-pick-${account.platform}`}
            checked={selected}
            onChange={() => selectAccount(account.platform, account.id)}
            aria-label={`Show ${account.profile?.name} in the widget`}
          />
        )}
        {account.profile?.avatar
          ? <img className="wg-cr-avatar" src={account.profile.avatar} alt="" referrerPolicy="no-referrer" />
          : <span className="wg-cr-avatar" aria-hidden="true" />}
        <div className="wg-cr-who">
          <span className="wg-cr-name">{account.profile?.name || account.ref}</span>
          <span className="wg-cr-meta">
            {account.profile?.handle && <>{account.profile.handle} · </>}
            {modeText(account)}
            {account.fetchedAt ? ` · updated ${formatAgo(account.fetchedAt, now).toLowerCase()}` : ''}
          </span>
          {account.error && <span className="wg-cr-error" role="status">{account.error.message}</span>}
        </div>
      </div>
      <div className="wg-cr-account-actions">
        {owner && account.platform === 'youtube' && account.scopes?.revenue && (
          <label className="wg-cr-inline">
            Currency
            <select value={account.currency || 'USD'} onChange={(e) => setAccountCurrency(account.id, e.target.value)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
        {account.error && (
          account.error.code === 'REVOKED' || account.error.code === 'PERMISSION'
            ? canConnect && <button type="button" className="wg-btn" disabled={busy} onClick={() => onConnectOwner(account.scopes?.revenue)}>Reconnect…</button>
            : <button type="button" className="wg-btn" onClick={() => refreshAccount(account.id, { force: true })}>Try Again</button>
        )}
        {!owner && canConnect && (
          <button type="button" className="wg-btn" disabled={busy} onClick={() => onConnectOwner(false)} title="Sign in as this channel’s owner to add 28-day analytics">
            Connect as Owner…
          </button>
        )}
        {confirming ? (
          <>
            <span className="wg-cr-confirm">{owner ? 'Disconnect and delete its data?' : 'Remove and delete its history?'}</span>
            <button type="button" className="wg-btn wg-btn-quiet" onClick={() => setConfirming(false)} disabled={removing}>Cancel</button>
            <button type="button" className="wg-btn wg-btn-danger" onClick={remove} disabled={removing}>{owner ? 'Disconnect' : 'Remove'}</button>
          </>
        ) : (
          <button type="button" className="wg-btn wg-btn-quiet" onClick={() => setConfirming(true)}>{owner ? 'Disconnect…' : 'Remove…'}</button>
        )}
      </div>
    </li>
  );
}

export default function CreatorAccounts({ platform }) {
  const config = useCreatorConfig();
  const accounts = useCreatorAccounts(platform);
  const prefs = useCreatorPrefs();
  const { ready } = useCreatorState();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(null); // 'add' | 'connect'
  const [message, setMessage] = useState(null); // { tone: 'error' | 'info', text }
  const [revenue, setRevenue] = useState(false);
  const abortRef = useRef(null);
  const [now] = useState(() => Date.now());
  const youtube = platform === 'youtube';
  const canLookup = Boolean(config?.youtube?.lookup);
  const canConnect = Boolean(config?.[platform]?.connect);
  const shownId = accounts.find((a) => a.id === prefs[platform])?.id || accounts[0]?.id;

  useEffect(() => () => abortRef.current?.abort(), []);

  const add = async (e) => {
    e.preventDefault();
    if (!input.trim() || busy) return;
    setBusy('add');
    setMessage(null);
    try {
      const id = await addPublicChannel(input);
      selectAccount('youtube', id);
      setInput('');
    } catch (err) {
      setMessage({ tone: 'error', text: err.message || 'Couldn’t add that channel.' });
    } finally {
      setBusy(null);
    }
  };

  const connect = async (withRevenue = revenue) => {
    if (busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy('connect');
    setMessage(null);
    try {
      const id = await connectAccount(platform, { revenue: withRevenue, currency: defaultCurrency(), signal: controller.signal });
      selectAccount(platform, id);
    } catch (err) {
      if (err?.code !== 'CANCELLED') setMessage({ tone: 'error', text: err.message || 'Couldn’t connect.' });
    } finally {
      abortRef.current = null;
      setBusy(null);
    }
  };

  const notSetUp = config && !config.error && !canLookup && !canConnect;

  return (
    <div className="wg-cr">
      {accounts.length > 0 && (
        <ul className="wg-cr-accounts" aria-label="YouTube channels">
          {accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              selected={account.id === shownId}
              showPick={accounts.length > 1}
              canConnect={canConnect}
              busy={Boolean(busy)}
              onConnectOwner={(withRevenue) => connect(withRevenue)}
              now={now}
            />
          ))}
        </ul>
      )}
      {ready && accounts.length === 0 && (
        <p className="wg-cr-note">No channels yet.</p>
      )}

      {config?.error && (
        <p className="wg-cr-message is-error" role="status">Can’t reach iWeb’s server ({config.error.message}). Accounts can’t be added until it’s reachable.</p>
      )}
      {notSetUp && (
        <p className="wg-cr-note">
          YouTube Analytics needs API credentials on the iWeb server, and this server has none yet.
          Whoever runs it can follow docs/CREATOR_WIDGETS.md to set it up.
        </p>
      )}

      {youtube && canLookup && (
        <form className="wg-cr-add" onSubmit={add}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="@handle, channel ID or channel link"
            aria-label="YouTube channel to add"
            spellCheck={false}
            disabled={busy === 'add'}
          />
          <button type="submit" className="wg-btn" disabled={!input.trim() || Boolean(busy)}>{busy === 'add' ? 'Adding…' : 'Add Channel'}</button>
        </form>
      )}
      {youtube && canLookup && (
        <p className="wg-cr-note">Public stats come from the YouTube Data API: subscribers (YouTube rounds them), total views and videos. No sign-in needed.</p>
      )}

      {canConnect && (
        <div className="wg-cr-connect">
          {busy === 'connect' ? (
            <>
              <span className="wg-cr-waiting">Waiting for Google… finish signing in in the window that opened.</span>
              <button type="button" className="wg-btn wg-btn-quiet" onClick={() => abortRef.current?.abort()}>Cancel</button>
            </>
          ) : (
            <>
              <button type="button" className="wg-btn wg-btn-primary" onClick={() => connect()} disabled={Boolean(busy)}>
                Connect with Google…
              </button>
              {youtube && (
                <label className="wg-cr-inline">
                  <input type="checkbox" checked={revenue} onChange={(e) => setRevenue(e.target.checked)} />
                  Include estimated revenue
                </label>
              )}
            </>
          )}
        </div>
      )}
      {canConnect && (
        <p className="wg-cr-note">
          For channels you own: adds 28-day views, watch time and subscriber changes from YouTube Analytics (read-only access). Revenue asks for permission to view revenue reports and is only available to channels in the YouTube Partner Program.
          {' '}Sign-in goes through iWeb’s server, which keeps the app secrets; this device keeps only an encrypted connection that works through that server.
        </p>
      )}

      {message && <p className={`wg-cr-message is-${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}

      <label className="wg-cr-inline wg-cr-interval">
        Refresh
        <select value={prefs.refreshMinutes} onChange={(e) => setRefreshMinutes(Number(e.target.value))}>
          {REFRESH_OPTIONS.map((o) => <option key={o.minutes} value={o.minutes}>{o.label}</option>)}
        </select>
        <span className="wg-cr-hint">Shared by both creator widgets; only while one is on screen.</span>
      </label>
    </div>
  );
}
