import { useRef, useState } from 'react';
import { initialsOf, removeAvatar, setAvatarFromFile } from '../../libs/profile/avatar';
import { useAvatarUrl } from '../../libs/profile/useAvatar';
import '../../styles/settings-profile.css';

// The profile at the top of the Settings sidebar: a round photo (stored in iWebDB) or, without
// one, a macOS Contacts-style monogram, and the user's name. Click the avatar to choose a
// photo; the × removes it.

export default function ProfileCard({ name }) {
  const avatarUrl = useAvatarUrl();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const displayName = name || 'iWeb';

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      await setAvatarFromFile(file);
    } catch (err) {
      setError(err?.name === 'AvatarError' ? err.message : 'The photo couldn’t be saved.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    setError('');
    try {
      await removeAvatar();
    } catch {
      setError('The photo couldn’t be removed.');
    }
  };

  return (
    <div className="profile-card">
      <div className="profile-avatar-wrap">
        <button
          type="button"
          className={`profile-avatar${busy ? ' is-busy' : ''}`}
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          aria-label={avatarUrl ? 'Change profile photo' : 'Add profile photo'}
          title={avatarUrl ? 'Change photo' : 'Add photo'}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" draggable={false} />
          ) : (
            <span className="profile-monogram" aria-hidden="true">{initialsOf(name) || (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <circle cx="12" cy="8.5" r="4.2" />
                <path d="M4 20.5c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5z" />
              </svg>
            )}</span>
          )}
          <span className="profile-avatar-edit" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
              <circle cx="12" cy="12.5" r="3.2" />
            </svg>
          </span>
        </button>
        {avatarUrl && !busy && (
          <button type="button" className="profile-avatar-remove" onClick={handleRemove} aria-label="Remove profile photo" title="Remove photo">
            <svg viewBox="0 0 12 12" width="8" height="8" aria-hidden="true">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFile} />
      </div>
      <div className="profile-text">
        <span className="profile-name" title={displayName}>{displayName}</span>
        {error && <span className="profile-error" role="alert">{error}</span>}
      </div>
    </div>
  );
}
