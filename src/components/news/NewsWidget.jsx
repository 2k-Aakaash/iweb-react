import { useEffect, useState } from 'react';
import GlassSurface from '../glass/GlassSurface';
import { useFavicons } from '../../libs/favicons/useFavicons';
import { formatPublishedAt, hostOf } from '../../libs/news/newsArticles';
import { openArticle, openNews } from '../../libs/news/newsEvents';
import { useNewsFeed, useNewsRotation } from '../../libs/news/useNews';
import { NewsGlyph } from './NewsIcons';
import '../../styles/news.css';

// The News widget, in macOS widget sizes (Edit Widgets): small (square: the headline),
// medium (header, headline, publisher) and large (the lead story plus the next headlines).
// The lead story changes every 10 seconds among those already loaded (the rotation never
// fetches). Clicking opens the News app. Not a live region: screen readers aren't interrupted.

// A publisher's icon (favicon from the shared cache), or its first letter.
function Publisher({ article, icons }) {
  const host = hostOf(article.sourceUrl);
  const src = host ? icons[host] : null;
  return (
    <span className="news-widget-pub">
      {src ? <img src={src} alt="" draggable={false} /> : article.sourceName.charAt(0).toUpperCase()}
    </span>
  );
}

// Warms the News app's lazy chunk on hover/focus so it opens instantly.
const preloadNewsApp = () => {
  import('./NewsModal').catch(() => {});
};

export default function NewsWidget({ size = 'medium' }) {
  const { feed, articles } = useNewsFeed({ category: 'top' });
  const article = useNewsRotation(articles);
  const loading = !article && (!feed || feed.status === 'loading' || feed.status === 'idle');
  // Large: the next three stories after the lead one.
  const more = size === 'large' && article
    ? articles.slice(articles.indexOf(article) + 1).concat(articles.slice(0, articles.indexOf(article))).slice(0, 3)
    : [];
  const host = hostOf(article?.sourceUrl);
  const icons = useFavicons([host, ...more.map((a) => hostOf(a.sourceUrl))].filter(Boolean));

  // Keeps "5 min ago" current.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  let message = null;
  if (!article) {
    if (loading) message = 'Loading top stories…';
    else if (feed?.error?.code === 'OFFLINE') message = 'You’re offline. Stories will appear when you’re back online.';
    else message = 'No stories right now.';
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={`news-widget news-widget-${size} glass-host`}
      onClick={() => openNews()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openNews();
        }
      }}
      onPointerEnter={preloadNewsApp}
      onFocus={preloadNewsApp}
      aria-label={article ? `News: ${article.title}, ${article.sourceName}. Open News` : 'Open News'}
      title={article ? `${article.title} — ${article.sourceName}` : undefined}
    >
      <GlassSurface preset="card" />
      <span className="news-widget-head" aria-hidden="true">
        <span className="news-widget-icon"><NewsGlyph size={12} /></span>
        <span className="news-widget-app">News</span>
        {size !== 'small' && <span className="news-widget-section">Top Stories</span>}
        {article && size !== 'small' && <time className="news-widget-time" dateTime={article.publishedAt}>{formatPublishedAt(article.publishedAt, now)}</time>}
      </span>

      <span className="news-widget-story" aria-hidden="true">
        {article ? (
          // Keyed by article: each new story mounts and plays the slide-in.
          <span key={article.id} className="news-widget-slide">
            <span className="news-widget-title">{article.title}</span>
            <span className="news-widget-source">
              <Publisher article={article} icons={icons} />
              {article.sourceName}
            </span>
          </span>
        ) : loading ? (
          <span className="news-widget-slide">
            <span className="news-widget-shimmer" />
            <span className="news-widget-shimmer is-short" />
          </span>
        ) : (
          <span className="news-widget-slide news-widget-message">{message}</span>
        )}
      </span>

      {more.length > 0 && (
        <ul className="news-widget-more">
          {more.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openArticle(a.url);
                }}
                aria-label={`${a.title}, ${a.sourceName}`}
              >
                <span className="news-widget-more-title">{a.title}</span>
                <span className="news-widget-more-meta"><Publisher article={a} icons={icons} />{a.sourceName} · {formatPublishedAt(a.publishedAt, now)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
