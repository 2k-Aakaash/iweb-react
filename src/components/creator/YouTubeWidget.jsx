import { useMemo } from 'react';
import CreatorWidget from './CreatorWidget';
import Sparkline from '../widgets/shared/Sparkline';
import { PlayGlyph } from './creatorGlyphs';
import { growth, growthRows } from './creatorMetrics';
import { formatCompact, formatDay, formatDuration, formatFull, formatMoney, formatWatchHours } from '../../libs/creator/creatorFormat';
import { useCreatorConfig, useWidgetAccount } from '../../libs/creator/useCreator';

// YouTube Analytics widget. Public channels (added by @handle, ID or link) show what the
// YouTube Data API makes public: subscribers (rounded by YouTube), total views, videos.
// Channels connected by their owner add YouTube Analytics for the last 28 days (views, watch
// time, subscribers gained and lost) and, if the owner allowed it, estimated revenue.

const OWNER_ONLY = 'Owner only';
const OWNER_TITLE = 'Only the channel’s owner can see this: connect the channel with Google in Manage Accounts.';

export default function YouTubeWidget({ size = 'medium' }) {
  const view = useWidgetAccount('youtube');
  const config = useCreatorConfig();
  const { account, snapshots } = view;
  const data = account?.data || null;

  const { primary, details, badge, extra } = useMemo(() => {
    if (!data) return { primary: [], details: [], badge: null, extra: null };
    const stats = data.stats || {};
    const owner = data.mode === 'owner';
    const analytics = owner ? data.analytics : null;
    const ok = analytics?.status === 'ok';
    const through = formatDay(analytics?.dataThrough || data.period?.end);
    const periodTitle = `the 28 days to ${through} (YouTube Analytics, Pacific Time). YouTube takes 2–3 days to finish each day’s numbers, so recent days can still rise.`;
    const unavailable = (what) => (owner ? (analytics?.message || `YouTube didn’t return ${what}.`) : OWNER_TITLE);
    const missing = owner ? 'Unavailable' : OWNER_ONLY;

    const revenue = owner ? data.revenue : null;
    let revenueMetric;
    if (revenue?.status === 'ok') {
      revenueMetric = { value: formatMoney(revenue.amount, revenue.currency), note: 'Estimated · 28d', title: `Estimated revenue in ${periodTitle}` };
    } else if (revenue?.status === 'unavailable') {
      revenueMetric = { value: null, missing: 'Unavailable', title: revenue.message };
    } else if (owner) {
      revenueMetric = { value: null, missing: 'Not allowed', title: 'To see estimated revenue, connect the channel again in Manage Accounts and allow revenue access.' };
    } else {
      revenueMetric = { value: null, missing: OWNER_ONLY, title: 'Revenue is private: only the channel’s owner can see it, by connecting the channel with revenue access.' };
    }

    const subscribers = {
      id: 'subscribers',
      label: 'Subscribers',
      value: formatCompact(stats.subscribers),
      missing: stats.subscribersHidden ? 'Hidden' : 'Unavailable',
      title: stats.subscribersHidden
        ? 'This channel hides its subscriber count.'
        : `${formatFull(stats.subscribers)} subscribers. YouTube rounds public subscriber counts down to three significant figures.`,
      change: growth(snapshots, 'subscribers', stats.subscribers, data.fetchedAt),
    };
    const primaryList = [
      subscribers,
      {
        id: 'views',
        label: 'Total views',
        value: formatCompact(stats.views),
        title: `${formatFull(stats.views)} views of the channel’s videos in all.`,
        change: growth(snapshots, 'views', stats.views, data.fetchedAt),
      },
      {
        id: 'views28',
        label: 'Views · 28d',
        value: ok ? formatCompact(analytics.views) : null,
        missing,
        note: ok && through ? `To ${through}` : null,
        title: ok ? `${formatFull(analytics.views)} views in ${periodTitle}` : unavailable('views'),
      },
      { id: 'revenue', label: 'Revenue · 28d', ...revenueMetric },
    ];

    const net = ok && Number.isFinite(analytics.subscribersGained) && Number.isFinite(analytics.subscribersLost)
      ? analytics.subscribersGained - analytics.subscribersLost
      : null;
    const detailList = [
      {
        id: 'watch',
        label: 'Watch time · 28d',
        value: ok ? formatWatchHours(analytics.watchMinutes) : null,
        missing,
        title: ok ? `${formatFull(Math.round(analytics.watchMinutes / 60))} hours watched in ${periodTitle}` : unavailable('watch time'),
      },
      {
        id: 'net',
        label: 'Net subscribers · 28d',
        value: net === null ? null : `${net > 0 ? '+' : net < 0 ? '−' : ''}${formatCompact(Math.abs(net))}`,
        missing,
        title: net === null ? unavailable('subscriber changes') : `${formatFull(analytics.subscribersGained)} gained and ${formatFull(analytics.subscribersLost)} lost in ${periodTitle}`,
      },
      {
        id: 'duration',
        label: 'Avg view duration',
        value: ok ? formatDuration(analytics.avgViewDuration) : null,
        missing,
        title: ok ? `Average length of a view in ${periodTitle}` : unavailable('view duration'),
      },
      {
        id: 'videos',
        label: 'Videos',
        value: formatCompact(stats.videos),
        missing: 'Unavailable',
        title: `${formatFull(stats.videos)} public videos.`,
      },
    ];

    const daily = ok ? (analytics.daily || []).map(([, v]) => v) : [];
    const extraNode = daily.length > 1 ? (
      <div className="crw-chart" title={`Daily views in ${periodTitle}`}>
        <span className="crw-chart-label">Daily views · 28d</span>
        <Sparkline values={daily} width={290} height={34} className="crw-spark" />
      </div>
    ) : (
      <div className="crw-details crw-growth">
        {growthRows(snapshots, 'subscribers', 'Subscribers', stats.subscribers, data.fetchedAt).slice(0, 2).map((m) => (
          <div key={m.id} className="crw-row" title={m.title}>
            <span className="crw-row-label">{m.label}</span>
            <span className={`crw-row-value${m.value === null ? ' is-missing' : ''}`}>{m.value ?? m.missing}</span>
          </div>
        ))}
      </div>
    );

    return {
      primary: primaryList,
      details: detailList,
      badge: owner ? (account.scopes?.revenue ? 'Owner · Revenue' : 'Owner') : 'Public stats',
      extra: extraNode,
    };
  }, [data, snapshots, account?.scopes?.revenue]);

  let empty;
  if (config && !config.error && !config.youtube.lookup && !config.youtube.connect) {
    empty = { message: 'YouTube Analytics isn’t set up on this iWeb server yet.', action: { label: 'Learn More' } };
  } else {
    empty = { message: 'Add a YouTube channel to see its subscribers and views.', action: { label: 'Add Channel' } };
  }

  return (
    <CreatorWidget
      id="youtube"
      title="YouTube Analytics"
      glyph={<PlayGlyph size={size === 'small' ? 13 : 15} />}
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
