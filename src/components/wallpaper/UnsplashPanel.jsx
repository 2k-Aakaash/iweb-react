import { useEffect, useRef, useState } from 'react';
import { CURATED_TOPICS, acquirePhoto, changeUnsplashBackground, prefetchNextUnsplash, searchWallpapers } from '../../libs/wallpaper/discovery';
import { getActiveWallpaper, setActiveWallpaper } from '../../libs/wallpaper/settings';
import SegmentedControl from './SegmentedControl';
import Attribution from './Attribution';
import { describeWallpaperError, formatResetTime, isAbortError, plural, sameRef } from './wallpaperUi';

const DISCOVERY_OPTIONS = [
  { value: 'topics', label: 'Topics' },
  { value: 'keyword', label: 'Keyword' },
  { value: 'random', label: 'Random' }
];

const EMPTY_SEARCH = {
  query: '',
  page: 0,
  totalPages: 0,
  results: [],
  fromCache: false,
  limitReached: false,
  loading: false,
  error: '',
  submitted: false
};

function ResultCard({ photo, cached, isActive, loading, blocked, onClick }) {
  const name = photo.photographer?.name || 'Unknown photographer';
  let label = `Use photo by ${name}`;
  if (cached) label += ' (cached)';
  if (isActive) label += ' (active)';
  if (blocked) label += ', unavailable until new downloads resume';

  return (
    <li className={`wp-card ${isActive ? 'is-active' : ''} ${blocked ? 'is-blocked' : ''}`}>
      <button
        type="button"
        className="wp-card-button"
        aria-pressed={isActive}
        aria-label={label}
        aria-busy={loading || undefined}
        aria-disabled={blocked || undefined}
        title={photo.description || `Photo by ${name}`}
        onClick={() => onClick(photo)}
      >
        {photo.urls?.small ? (
          <img
            className="wp-card-img"
            src={photo.urls.small}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            style={photo.color ? { backgroundColor: photo.color } : undefined}
          />
        ) : (
          <span className="wp-card-placeholder" aria-hidden="true">🖼️</span>
        )}
        {cached && <span className="wp-badge wp-badge-cached">Cached</span>}
        {isActive && <span className="wp-badge wp-badge-active">Active</span>}
        {loading && (
          <span className="wp-card-busy" aria-hidden="true">
            <span className="wp-spinner" />
          </span>
        )}
      </button>
      <Attribution photographer={photo.photographer} photoPageUrl={photo.photoPageUrl} />
    </li>
  );
}

export default function UnsplashPanel({ settings, onSettingsChange, quota, online, cachedIds, activeKey, onAnnounce }) {
  const [keywordInput, setKeywordInput] = useState(settings.keyword || '');
  const [search, setSearch] = useState(EMPTY_SEARCH);
  const [changing, setChanging] = useState(false);
  const [notice, setNotice] = useState(null);
  const [acquiring, setAcquiring] = useState(() => new Set());
  const searchControllerRef = useRef(null);
  const searchSeqRef = useRef(0);
  const acquiringRef = useRef(new Set());
  const changingRef = useRef(false);

  // Searches only feed this panel, so abort an in-flight one when the panel unmounts.
  // Acquisitions and Change Background are allowed to finish: the user asked for a new wallpaper.
  useEffect(() => {
    const seqRef = searchSeqRef;
    const controllerRef = searchControllerRef;
    return () => {
      seqRef.current += 1;
      if (controllerRef.current) controllerRef.current.abort();
    };
  }, []);

  const limitReached = Boolean(quota && quota.remaining <= 0);
  const resetTime = quota ? formatResetTime(quota.resetsAt) : '';
  const cacheOnly = limitReached || !online;
  const topics = settings.topics || [];
  const mode = settings.discoveryMode || 'topics';

  const showError = (err) => {
    const message = describeWallpaperError(err, { resetsAt: quota?.resetsAt });
    if (!message) return;
    setNotice({ tone: 'error', text: message });
    onAnnounce(message);
  };

  const showInfo = (text) => {
    setNotice({ tone: 'success', text });
    onAnnounce(text);
  };

  const runSearch = async (query, page) => {
    if (searchControllerRef.current) searchControllerRef.current.abort();
    const controller = new AbortController();
    searchControllerRef.current = controller;
    const seq = ++searchSeqRef.current;

    setSearch((prev) => ({
      ...(page === 1 ? EMPTY_SEARCH : prev),
      query,
      loading: true,
      error: '',
      submitted: true
    }));

    try {
      const res = await searchWallpapers({ query, page, signal: controller.signal });
      if (seq !== searchSeqRef.current) return;
      setSearch((prev) => {
        const base = page === 1 ? [] : prev.results;
        const seen = new Set(base.map((p) => p.photoId));
        const fresh = [];
        for (const photo of res.results || []) {
          if (!seen.has(photo.photoId)) {
            seen.add(photo.photoId);
            fresh.push(photo);
          }
        }
        return {
          query,
          page,
          totalPages: res.totalPages || 0,
          results: base.concat(fresh),
          fromCache: Boolean(res.fromCache),
          limitReached: Boolean(res.limitReached),
          loading: false,
          error: '',
          submitted: true
        };
      });
    } catch (err) {
      if (seq !== searchSeqRef.current) return;
      if (isAbortError(err)) {
        setSearch((prev) => ({ ...prev, loading: false }));
        return;
      }
      console.error('Unsplash search failed:', err);
      const message = describeWallpaperError(err, { resetsAt: quota?.resetsAt });
      setSearch((prev) => ({ ...prev, loading: false, error: message }));
      onAnnounce(message);
    } finally {
      if (searchControllerRef.current === controller) searchControllerRef.current = null;
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    const query = keywordInput.trim();
    if (!query) {
      setSearch({ ...EMPTY_SEARCH, submitted: true, error: 'Enter something to search for.' });
      return;
    }
    if (query !== settings.keyword) onSettingsChange({ keyword: query });
    runSearch(query, 1);
  };

  const handleClearSearch = () => {
    searchSeqRef.current += 1;
    if (searchControllerRef.current) {
      searchControllerRef.current.abort();
      searchControllerRef.current = null;
    }
    setKeywordInput('');
    setSearch(EMPTY_SEARCH);
    if (settings.keyword) onSettingsChange({ keyword: '' });
  };

  const handleLoadMore = () => {
    if (search.loading || search.page >= search.totalPages) return;
    runSearch(search.query, search.page + 1);
  };

  const handleResultClick = async (photo) => {
    const photoId = photo.photoId;
    if (acquiringRef.current.has(photoId)) return;
    const ref = { source: 'unsplash', id: photoId };
    const cached = Boolean(photo.cached) || cachedIds.has(photoId);

    if (cached) {
      try {
        await setActiveWallpaper(ref);
        setNotice(null);
      } catch (err) {
        console.error('Failed to set wallpaper:', err);
        showError(err);
      }
      return;
    }

    if (limitReached) {
      const text = quota?.paused
        ? `This photo isn’t saved yet and Unsplash is busy right now.${resetTime ? ` Try again after ${resetTime}.` : ''}`
        : `This photo isn’t saved yet and today’s new-photo limit is used up.${resetTime ? ` Try again after ${resetTime}.` : ''}`;
      setNotice({ tone: 'warning', text });
      onAnnounce(text);
      return;
    }

    acquiringRef.current.add(photoId);
    setAcquiring(new Set(acquiringRef.current));
    setNotice(null);
    try {
      await acquirePhoto(photo, { query: search.query });
      await setActiveWallpaper(ref);
      showInfo(`Saved and applied the photo by ${photo.photographer?.name || 'this photographer'}.`);
    } catch (err) {
      console.error('Failed to download Unsplash photo:', err);
      showError(err);
    } finally {
      acquiringRef.current.delete(photoId);
      setAcquiring(new Set(acquiringRef.current));
    }
  };

  const handleChangeBackground = async () => {
    if (changingRef.current) return;
    changingRef.current = true;
    setChanging(true);
    setNotice(null);
    try {
      const result = await changeUnsplashBackground({ settings });
      prefetchNextUnsplash({ settings }); // next change is then instant
      const record = result?.record;
      if (record?.photoId) {
        const ref = { source: 'unsplash', id: record.photoId };
        if (!sameRef(getActiveWallpaper(), ref)) await setActiveWallpaper(ref);
        const by = record.photographer?.name ? ` by ${record.photographer.name}` : '';
        showInfo(result.origin === 'new'
          ? `Downloaded a new photo${by}.`
          : `Showing a saved photo${by}.`);
      }
    } catch (err) {
      // Replaced by a newer change (e.g. the Dock's Change BG): that one shows the result.
      if (!isAbortError(err)) {
        console.error('Change Background failed:', err);
        showError(err);
      }
    } finally {
      changingRef.current = false;
      setChanging(false);
    }
  };

  const toggleTopic = (id) => {
    const next = topics.includes(id) ? topics.filter((t) => t !== id) : [...topics, id];
    onSettingsChange({ topics: next });
  };

  let modeHint;
  if (mode === 'topics') {
    modeHint = topics.length > 0
      ? `Change Background picks from ${plural(topics.length, 'selected topic')}.`
      : 'Select one or more topics for Change Background.';
  } else if (mode === 'keyword') {
    modeHint = settings.keyword
      ? `Change Background uses the keyword “${settings.keyword}”.`
      : 'Search below to set the keyword Change Background uses.';
  } else {
    modeHint = topics.length > 0
      ? `Change Background picks a random landscape photo from ${plural(topics.length, 'saved topic')}.`
      : 'Change Background picks a random landscape photo.';
  }

  let allowanceMessage = '';
  if (!online) {
    allowanceMessage = 'You’re offline. Change Background will shuffle photos already saved on this device.';
  } else if (limitReached && quota?.paused) {
    allowanceMessage = cachedIds.size > 0
      ? `Unsplash is busy right now. Change Background will shuffle your saved photos${resetTime ? ` until ${resetTime}` : ''}.`
      : `Unsplash is busy right now. New photos are available again${resetTime ? ` at ${resetTime}` : ' shortly'}.`;
  } else if (limitReached) {
    allowanceMessage = cachedIds.size > 0
      ? `Today’s new-photo limit is reached. Change Background will shuffle your saved Unsplash photos${resetTime ? ` until ${resetTime}` : ''}.`
      : `Today’s new-photo limit is reached and no Unsplash photos are saved yet. New photos are available again${resetTime ? ` at ${resetTime}` : ' tomorrow'}.`;
  }

  const hasMore = search.page > 0 && search.page < search.totalPages;

  return (
    <div className="wp-panel">
      <div className="settings-group-card-title">Unsplash</div>
      <div className="settings-group-card">
        <div className="settings-row wp-row-wrap">
          <span className="wp-hint wp-change-hint">Sets a new Unsplash photo as your background.</span>
          <button
            type="button"
            className="settings-btn settings-btn-primary wp-btn-hero"
            onClick={handleChangeBackground}
            disabled={changing}
            aria-busy={changing || undefined}
          >
            {changing && <span className="wp-spinner wp-spinner-inline" aria-hidden="true" />}
            {cacheOnly ? 'Shuffle cached' : 'Change Background'}
          </button>
        </div>
        {allowanceMessage && (
          <div className="settings-row">
            <p className="wp-notice is-warning">{allowanceMessage}</p>
          </div>
        )}
        {notice && (
          <div className="settings-row">
            <p className={`wp-notice is-${notice.tone}`}>{notice.text}</p>
          </div>
        )}
      </div>

      <div className="settings-group-card-title">Discovery</div>
      <div className="settings-group-card">
        <div className="settings-row wp-row-wrap">
          <span className="settings-label">Mode</span>
          <SegmentedControl
            label="Discovery mode"
            options={DISCOVERY_OPTIONS}
            value={mode}
            onChange={(value) => onSettingsChange({ discoveryMode: value })}
          />
        </div>
        {mode === 'topics' && (
          <div className="settings-row">
            <div className="wp-chips" role="group" aria-label="Topics">
              {CURATED_TOPICS.map((topic) => {
                const on = topics.includes(topic.id);
                return (
                  <button
                    key={topic.id}
                    type="button"
                    className={`wp-chip ${on ? 'is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() => toggleTopic(topic.id)}
                  >
                    {topic.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="settings-row">
          <span className="wp-hint">{modeHint}</span>
        </div>
      </div>

      <div className="settings-group-card-title">Search Unsplash</div>
      <div className="settings-group-card">
        <form className="settings-row wp-search-form" role="search" onSubmit={handleSearchSubmit}>
          <input
            type="search"
            className="settings-input-text wp-search-input"
            placeholder="e.g. mountains, city lights, ocean"
            aria-label="Search Unsplash photos"
            value={keywordInput}
            maxLength={100}
            onChange={(e) => setKeywordInput(e.target.value)}
          />
          <button type="submit" className="settings-btn settings-btn-primary">
            Search
          </button>
          <button
            type="button"
            className="settings-btn settings-btn-secondary"
            onClick={handleClearSearch}
            disabled={!keywordInput && !search.submitted}
          >
            Clear
          </button>
        </form>

        {search.submitted && (
          <div className="wp-results">
            {search.fromCache && !search.loading && (
              <p className="wp-hint">
                {search.limitReached
                  ? (quota?.paused ? 'Unsplash is busy: showing matches from your saved photos only.' : 'Daily limit reached: showing matches from your saved photos only.')
                  : 'Offline: showing matches from your saved photos only.'}
              </p>
            )}
            {search.error && <p className="wp-notice is-error">{search.error}</p>}
            {search.results.length > 0 && (
              <ul className="wp-grid wp-grid-results" aria-label={`Results for ${search.query}`}>
                {search.results.map((photo) => {
                  const cached = Boolean(photo.cached) || cachedIds.has(photo.photoId);
                  return (
                    <ResultCard
                      key={photo.photoId}
                      photo={photo}
                      cached={cached}
                      isActive={activeKey === `unsplash:${photo.photoId}`}
                      loading={acquiring.has(photo.photoId)}
                      blocked={!cached && limitReached}
                      onClick={handleResultClick}
                    />
                  );
                })}
              </ul>
            )}
            {!search.loading && !search.error && search.results.length === 0 && (
              <p className="wp-empty">No photos found for “{search.query}”.</p>
            )}
            {search.loading && (
              <p className="wp-hint wp-loading-line">
                <span className="wp-spinner wp-spinner-inline" aria-hidden="true" />
                Searching…
              </p>
            )}
            {hasMore && !search.loading && (
              <button type="button" className="settings-btn settings-btn-secondary wp-load-more" onClick={handleLoadMore}>
                Load More
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
