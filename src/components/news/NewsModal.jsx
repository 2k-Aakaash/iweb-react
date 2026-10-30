import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import GlassSurface from '../glass/GlassSurface';
import { useMacWindow } from '../../libs/window/useMacWindow';
import { useFavicons } from '../../libs/favicons/useFavicons';
import { NEWS_CATEGORIES, NEWS_EDITIONS, categoryLabel } from '../../libs/news/newsConfig';
import { filterArticles, formatPublishedAt, hostOf } from '../../libs/news/newsArticles';
import { refresh, search as searchNewsFeed, setEdition } from '../../libs/news/newsStore';
import { useNewsFeed, useNewsState } from '../../libs/news/useNews';
import { openArticle } from '../../libs/news/newsEvents';
import { BackGlyph, ExternalGlyph, NewsGlyph, RefreshGlyph, SearchGlyph } from './NewsIcons';
import '../../styles/news.css';

// The News app: a macOS-style window (useMacWindow: genie into its Dock icon, zoom) over the
// shared news store. Typing filters every story already loaded; Enter (or "Search Google
// News") runs one remote search. Feeds carry headline, publisher, time and other coverage
// only, so the detail view shows exactly that and links to the full story.

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function PublisherIcon({ article, icons, size = 'md' }) {
  const host = hostOf(article.sourceUrl);
  const src = host ? icons[host] : null;
  return (
    <span className={`news-pub news-pub-${size}`} aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} /> : <span>{article.sourceName.charAt(0).toUpperCase()}</span>}
    </span>
  );
}

function Meta({ article, now }) {
  return (
    <span className="news-meta">
      <span className="news-meta-source">{article.sourceName}</span>
      <span aria-hidden="true">·</span>
      <time dateTime={article.publishedAt}>{formatPublishedAt(article.publishedAt, now)}</time>
    </span>
  );
}

function FeaturedStory({ article, icons, now, onSelect }) {
  const more = article.related.length;
  return (
    <article className="news-featured">
      <button type="button" className="news-featured-main" onClick={() => onSelect(article.id)}>
        <span className="news-featured-kicker">
          <PublisherIcon article={article} icons={icons} size="lg" />
          <Meta article={article} now={now} />
        </span>
        <h3 className="news-featured-title">{article.title}</h3>
        {more > 0 && (
          <span className="news-featured-more">
            Also covered by {article.related.map((r) => r.sourceName).filter(Boolean).slice(0, 3).join(', ')}
            {more > 3 ? ` and ${more - 3} more` : ''}
          </span>
        )}
      </button>
      <button type="button" className="news-open" onClick={() => openArticle(article.url)} aria-label={`Read “${article.title}” on ${article.sourceName}`}>
        Read <ExternalGlyph />
      </button>
    </article>
  );
}

function StoryRow({ article, icons, now, onSelect }) {
  return (
    <li className="news-row">
      <button type="button" className="news-row-main" onClick={() => onSelect(article.id)}>
        <PublisherIcon article={article} icons={icons} />
        <span className="news-row-text">
          <span className="news-row-title">{article.title}</span>
          <Meta article={article} now={now} />
        </span>
      </button>
      <button type="button" className="news-row-open" onClick={() => openArticle(article.url)} aria-label={`Open “${article.title}” on ${article.sourceName}`} title="Open story">
        <ExternalGlyph />
      </button>
    </li>
  );
}

function StoryDetail({ article, icons, now, onBack }) {
  const backRef = useRef(null);
  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, [article.id]);
  return (
    <article className="news-detail" aria-labelledby="news-detail-title">
      <button ref={backRef} type="button" className="news-back" onClick={onBack}>
        <BackGlyph /> Stories
      </button>
      <div className="news-detail-source">
        <PublisherIcon article={article} icons={icons} size="lg" />
        <Meta article={article} now={now} />
      </div>
      <h2 id="news-detail-title" className="news-detail-title">{article.title}</h2>
      <p className="news-detail-note">
        Google News lists the headline and publisher; the full story is on {article.sourceName}’s site.
      </p>
      <button type="button" className="news-read" onClick={() => openArticle(article.url)}>
        Read full story <ExternalGlyph />
      </button>
      {article.related.length > 0 && (
        <section className="news-related" aria-label="More coverage">
          <h3>More coverage</h3>
          <ul>
            {article.related.map((r) => (
              <li key={r.url}>
                <button type="button" onClick={() => openArticle(r.url)}>
                  <span className="news-related-title">{r.title}</span>
                  {r.sourceName && <span className="news-related-source">{r.sourceName}</span>}
                  <ExternalGlyph />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

function Skeleton() {
  return (
    <div className="news-skeleton" aria-hidden="true">
      <div className="news-skel news-skel-featured" />
      {Array.from({ length: 6 }, (_, i) => <div key={i} className="news-skel news-skel-row" />)}
    </div>
  );
}

export default function NewsModal({ open = true, setOpen = () => {} }) {
  const windowRef = useRef(null);
  const overlayRef = useRef(null);
  const searchRef = useRef(null);
  const bodyRef = useRef(null);
  const titleId = useId();
  const menusRef = useRef(null); // menu-bar menus, set below once the handlers exist
  const macWin = useMacWindow({ app: 'news', open, setOpen, windowRef, overlayRef, menus: menusRef });
  const shown = macWin.mounted;

  const [category, setCategory] = useState('top');
  const [query, setQuery] = useState('');
  const [remoteQuery, setRemoteQuery] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [online, setOnline] = useState(() => navigator.onLine !== false);

  const snapshot = useNewsState();
  const { edition } = snapshot;
  const target = remoteQuery ? { query: remoteQuery } : { category };
  const { feed, articles } = useNewsFeed({ ...target, enabled: shown });

  // Local search: every story loaded in any section or search, newest first.
  const trimmed = query.trim();
  const allArticles = useMemo(
    () => Object.values(snapshot.articles).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)),
    [snapshot.articles],
  );
  const stories = remoteQuery ? articles : trimmed ? filterArticles(allArticles, trimmed).slice(0, 80) : articles;
  const selected = selectedId ? snapshot.articles[selectedId] : null;

  const hosts = useMemo(() => [
    ...stories.slice(0, 40).map((a) => hostOf(a.sourceUrl)),
    selected ? hostOf(selected.sourceUrl) : null,
  ], [stories, selected]);
  const icons = useFavicons(hosts);

  // Relative times stay current while the window is open.
  useEffect(() => {
    if (!shown) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [shown]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Focus the search field once the window is visible (it is hidden while it genies out),
  // and return focus to whatever opened News on close.
  const focusSearch = useEffectEvent(() => searchRef.current?.focus({ preventScroll: true }));
  useEffect(() => {
    if (!shown) return undefined;
    const returnTo = document.activeElement;
    let frame = 0;
    const focusWhenShown = () => {
      if (windowRef.current?.classList.contains('genie-hidden')) {
        frame = requestAnimationFrame(focusWhenShown);
        return;
      }
      focusSearch();
    };
    focusWhenShown();
    return () => {
      cancelAnimationFrame(frame);
      if (returnTo instanceof HTMLElement && returnTo !== document.body && returnTo.isConnected) {
        returnTo.focus({ preventScroll: true });
      }
    };
  }, [shown]);

  const scrollTop = () => bodyRef.current?.scrollTo({ top: 0 });

  const chooseCategory = (id) => {
    setCategory(id);
    setQuery('');
    setRemoteQuery(null);
    setSelectedId(null);
    scrollTop();
  };

  // Menu bar: File → Refresh, View → the sections.
  useEffect(() => {
    menusRef.current = () => ({
      File: [{ label: 'Refresh', disabled: !online, onSelect: () => refresh(target) }],
      View: NEWS_CATEGORIES.map((c) => ({
        label: categoryLabel(c, edition),
        checked: !remoteQuery && category === c.id,
        onSelect: () => chooseCategory(c.id),
      })),
    });
  });

  const runRemoteSearch = () => {
    if (trimmed.length < 2) return;
    setRemoteQuery(trimmed);
    setSelectedId(null);
    searchNewsFeed(trimmed);
    scrollTop();
  };

  const clearSearch = () => {
    setQuery('');
    setRemoteQuery(null);
    searchRef.current?.focus();
  };

  // Escape steps back: story → list, search → section, then closes. Listened for on the
  // document while open, since focus can fall to the page when a view is replaced.
  const handleEscape = useEffectEvent((e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    if (selectedId) setSelectedId(null);
    else if (query || remoteQuery) clearSearch();
    else macWin.close();
  });
  useEffect(() => {
    if (!shown) return undefined;
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [shown]);

  const handleKeyDown = (e) => {
    if (e.key === 'Tab') {
      const win = windowRef.current;
      const items = win ? [...win.querySelectorAll(TABBABLE)].filter((el) => el.getClientRects().length) : [];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  if (!shown) return null;

  const loadingFeed = feed?.status === 'loading';
  const showSkeleton = !stories.length && (loadingFeed || !feed || feed.status === 'idle') && !trimmed;
  const error = feed?.error ?? null;
  const fetchedAt = feed?.fetchedAt;
  const updated = fetchedAt ? `Updated ${formatPublishedAt(new Date(fetchedAt).toISOString(), now).toLowerCase()}` : 'Not updated yet';
  const sectionName = remoteQuery ? `“${remoteQuery}”` : trimmed ? 'Saved stories' : categoryLabel(NEWS_CATEGORIES.find((c) => c.id === category), edition);
  const [featured, ...rest] = !trimmed || remoteQuery ? stories : [];
  const listed = trimmed && !remoteQuery ? stories : rest;

  return (
    <div ref={overlayRef} className="news-overlay" onPointerDown={(e) => e.target === e.currentTarget && macWin.close()}>
      <div
        ref={windowRef}
        className={`news-window glass-host${macWin.maximized ? ' window-maximized' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <GlassSurface preset="window" />

        <header className="news-header">
          <div className="news-lights">
            <button type="button" className="news-light news-light-close" aria-label="Close News" title="Close" onClick={macWin.close}>
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3.5 3.5 5 5m0-5-5 5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
            </button>
            <button type="button" className="news-light news-light-minimize" aria-label="Minimize News" title="Minimize" onClick={macWin.minimize}>
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 6h6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
            </button>
            <button type="button" className="news-light news-light-zoom" aria-label={macWin.maximized ? 'Exit full size' : 'Zoom News'} title={macWin.maximized ? 'Exit Full Size' : 'Zoom'} onClick={macWin.toggleMaximize}>
              <svg viewBox="0 0 12 12" aria-hidden="true">
                {macWin.maximized
                  ? <path d="M5.5 5.5H2.9l2.6-2.6zM6.5 6.5h2.6L6.5 9.1z" fill="currentColor" />
                  : <path d="M3.5 3.5h3L3.5 6.5zM8.5 8.5h-3l3-3z" fill="currentColor" />}
              </svg>
            </button>
          </div>
          <div className="news-title">
            <span className="news-title-icon" aria-hidden="true"><NewsGlyph size={18} /></span>
            <div>
              <h2 id={titleId}>News</h2>
              <p>Your world, in focus · {updated}</p>
            </div>
          </div>
          <div className="news-header-actions">
            <label className="news-edition">
              <span className="news-sr">Edition</span>
              <select value={edition} onChange={(e) => { setEdition(e.target.value); setSelectedId(null); }}>
                {NEWS_EDITIONS.map((ed) => <option key={ed.id} value={ed.id}>{ed.label}</option>)}
              </select>
            </label>
            <button
              type="button"
              className={`news-icon-btn${loadingFeed ? ' is-spinning' : ''}`}
              onClick={() => refresh(target)}
              disabled={loadingFeed || !online}
              aria-label="Refresh news"
              title={online ? 'Refresh' : 'Offline'}
            >
              <RefreshGlyph />
            </button>
          </div>
        </header>

        <div className="news-search-row">
          <label className="news-search">
            <SearchGlyph />
            <span className="news-sr">Search news</span>
            <input
              ref={searchRef}
              type="search"
              placeholder="Search headlines, topics, or sources"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setRemoteQuery(null);
                setSelectedId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  runRemoteSearch();
                }
              }}
            />
            {remoteQuery && loadingFeed && <span className="news-spinner" aria-label="Searching" />}
            {query && (
              <button type="button" className="news-search-clear" onClick={clearSearch} aria-label="Clear search">
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="currentColor" /><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#1c1c1e" strokeWidth="1.6" strokeLinecap="round" /></svg>
              </button>
            )}
          </label>
        </div>

        <nav className="news-tabs" aria-label="Sections">
          {NEWS_CATEGORIES.map((c) => {
            const active = !trimmed && !remoteQuery && c.id === category;
            return (
              <button key={c.id} type="button" className={`news-tab${active ? ' is-active' : ''}`} aria-pressed={active} onClick={() => chooseCategory(c.id)}>
                {categoryLabel(c, edition)}
              </button>
            );
          })}
        </nav>

        <div ref={bodyRef} className="news-body custom-scrollbar">
          {error && stories.length > 0 && (
            <div className="news-banner" role="status">
              <span>{error.code === 'OFFLINE' ? 'You’re offline. Showing saved stories.' : `${error.message} Showing saved stories.`}</span>
              {error.code !== 'OFFLINE' && <button type="button" onClick={() => refresh(target)}>Try Again</button>}
            </div>
          )}

          {selected ? (
            <StoryDetail article={selected} icons={icons} now={now} onBack={() => setSelectedId(null)} />
          ) : showSkeleton ? (
            <Skeleton />
          ) : stories.length === 0 ? (
            <div className="news-empty" role="status">
              {trimmed && !remoteQuery ? (
                <>
                  <h3>No saved stories match “{trimmed}”</h3>
                  <p>Search Google News for more, or try other words.</p>
                  <button type="button" className="news-read" onClick={runRemoteSearch} disabled={!online || trimmed.length < 2}>
                    <SearchGlyph /> Search Google News
                  </button>
                </>
              ) : error ? (
                <>
                  <h3>{error.code === 'OFFLINE' ? 'You’re offline' : 'News couldn’t load'}</h3>
                  <p>{error.code === 'OFFLINE' ? 'Stories you’ve opened before will appear here when saved.' : error.message}</p>
                  {error.code !== 'OFFLINE' && <button type="button" className="news-read" onClick={() => refresh(target)}>Try Again</button>}
                </>
              ) : (
                <>
                  <h3>No stories here right now</h3>
                  <p>Try another section or search.</p>
                  <button type="button" className="news-read" onClick={() => chooseCategory('top')}>Back to Top Stories</button>
                </>
              )}
            </div>
          ) : (
            <>
              <h3 className="news-section-title">{sectionName}</h3>
              {featured && <FeaturedStory article={featured} icons={icons} now={now} onSelect={setSelectedId} />}
              <ul className="news-list">
                {listed.map((a) => <StoryRow key={a.id} article={a} icons={icons} now={now} onSelect={setSelectedId} />)}
              </ul>
              {trimmed && !remoteQuery && (
                <button type="button" className="news-more-search" onClick={runRemoteSearch} disabled={!online || trimmed.length < 2}>
                  <SearchGlyph /> Search Google News for “{trimmed}”
                </button>
              )}
            </>
          )}
        </div>

        <footer className="news-footer">
          <span>
            {stories.length} {stories.length === 1 ? 'story' : 'stories'}
            {!online && ' · Offline, showing saved stories'}
          </span>
          <span>Headlines from Google News and the publishers shown</span>
        </footer>
      </div>
    </div>
  );
}
