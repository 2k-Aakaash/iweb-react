import { useMemo } from 'react';
import CreatorWidget from './CreatorWidget';
import { CameraGlyph, CommentGlyph, HeartGlyph } from './creatorGlyphs';
import { growth } from './creatorMetrics';
import { formatAgo, formatCompact, formatFull } from '../../libs/creator/creatorFormat';
import { useCreatorConfig, useWidgetAccount } from '../../libs/creator/useCreator';

// Instagram Analytics widget, for Business and Creator accounts connected with Instagram
// Login (Instagram's API doesn't serve personal accounts, or anyone's account without its
// owner signing in). Shows followers and posts, and the account insights Instagram reports
// for the last 28 days; each insight is optional (Instagram leaves some out for small
// accounts). Instagram's API has no revenue or earnings data, so none is shown.

const INSIGHTS = {
  reach: { label: 'Reach · 28d', title: 'Accounts that saw your content at least once in the last 28 days (Instagram insights).' },
  views: { label: 'Views · 28d', title: 'Times your content was played or shown in the last 28 days (Instagram insights).' },
  accounts_engaged: { label: 'Accounts engaged · 28d', title: 'Accounts that interacted with your content in the last 28 days.' },
  total_interactions: { label: 'Interactions · 28d', title: 'Likes, saves, comments, shares and replies in the last 28 days.' },
  profile_views: { label: 'Profile visits · 28d', title: 'Visits to your profile in the last 28 days.' },
  profile_links_taps: { label: 'Link taps · 28d', title: 'Taps on the links and contact buttons on your profile in the last 28 days.' },
};

export default function InstagramWidget({ size = 'medium' }) {
  const view = useWidgetAccount('instagram');
  const config = useCreatorConfig();
  const { account, snapshots } = view;
  const data = account?.data || null;

  const { primary, details, badge, extra } = useMemo(() => {
    if (!data) return { primary: [], details: [], badge: null, extra: null };
    const stats = data.stats || {};
    const insights = data.insights || { status: 'unavailable', values: {}, unavailable: [] };
    const insight = (id) => {
      const value = insights.values?.[id];
      if (Number.isFinite(value)) return { id, ...INSIGHTS[id], value: formatCompact(value), title: `${formatFull(value)}. ${INSIGHTS[id].title}` };
      const missing = insights.status === 'ok' ? 'Not provided' : 'Unavailable';
      const why = insights.status === 'ok'
        ? 'Instagram doesn’t provide this for this account right now (some insights need 100 or more followers).'
        : insights.message || 'Instagram didn’t return insights.';
      return { id, ...INSIGHTS[id], value: null, missing, title: why };
    };

    const primaryList = [
      {
        id: 'followers',
        label: 'Followers',
        value: formatCompact(stats.followers),
        missing: 'Unavailable',
        title: `${formatFull(stats.followers)} followers.`,
        change: growth(snapshots, 'followers', stats.followers, data.fetchedAt),
      },
      insight('reach'),
      insight('views'),
      {
        id: 'media',
        label: 'Posts',
        value: formatCompact(stats.media),
        missing: 'Unavailable',
        title: `${formatFull(stats.media)} posts.`,
        change: growth(snapshots, 'media', stats.media, data.fetchedAt),
      },
    ];
    const detailList = ['accounts_engaged', 'total_interactions', 'profile_views', 'profile_links_taps'].map(insight);

    const media = Array.isArray(data.media) ? data.media.slice(0, 3) : null;
    const extraNode = (
      <div className="crw-posts">
        <span className="crw-chart-label">Recent posts</span>
        {media === null && <span className="crw-row-value is-missing">Instagram didn’t return recent posts.</span>}
        {media?.length === 0 && <span className="crw-row-value is-missing">No posts yet.</span>}
        {media?.map((m) => {
          const line = (
            <>
              <span className="crw-post-type">{m.type}</span>
              <span className="crw-post-when">{formatAgo(m.at, data.fetchedAt)}</span>
              <span className="crw-post-stat" title="Likes (hidden when the owner hides likes)"><HeartGlyph /> {formatCompact(m.likes) ?? '—'}</span>
              <span className="crw-post-stat" title="Comments"><CommentGlyph /> {formatCompact(m.comments) ?? '—'}</span>
            </>
          );
          return m.url
            ? <a key={m.id} className="crw-post" href={m.url} target="_blank" rel="noopener noreferrer">{line}</a>
            : <span key={m.id} className="crw-post">{line}</span>;
        })}
      </div>
    );

    return { primary: primaryList, details: detailList, badge: data.profile?.accountType || null, extra: extraNode };
  }, [data, snapshots]);

  let empty;
  if (config && !config.error && !config.instagram.connect) {
    empty = { message: 'Instagram Analytics isn’t set up on this iWeb server yet.', action: { label: 'Learn More' } };
  } else {
    empty = { message: 'Connect an Instagram Business or Creator account to see its insights.', action: { label: 'Connect…' } };
  }

  return (
    <CreatorWidget
      id="instagram"
      title="Instagram Analytics"
      glyph={<CameraGlyph size={size === 'small' ? 13 : 15} />}
      size={size}
      view={view}
      config={config}
      badge={badge}
      primary={primary}
      details={details}
      extra={extra}
      empty={empty}
    />
  );
}
