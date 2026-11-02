# Creator Widgets: YouTube Analytics and Instagram Analytics

Two desktop widgets for creators, under **Creator Widgets** in the widget gallery (Settings → Widgets):

- **YouTube Analytics** shows any channel's public stats.
  - The channel's owner can connect it to add 28-day analytics and, optionally, estimated revenue.
- **Instagram Analytics** shows a connected Instagram Business or Creator account: followers, posts, and 28-day insights.

They use only the official Google and Meta APIs: no scraping, and no unofficial endpoints. Every number on screen is either:

- reported by those APIs, or
- worked out from earlier updates saved on the device.

When a number isn't available, the widget says why instead of showing 0.

## Contents

1. [How it fits into iWeb](#how-it-fits-into-iweb)
2. [Supported metrics](#supported-metrics)
3. [Setup](#setup)
4. [Security and privacy](#security-and-privacy)
5. [Refreshing, caching and history](#refreshing-caching-and-history)
6. [Errors and states](#errors-and-states)
7. [Known limitations](#known-limitations)
8. [Testing](#testing)

## How it fits into iWeb

The creator widgets are ordinary desktop widgets. Nothing about them uses a separate framework.

| Concern | Where |
| --- | --- |
| Position, size, visibility, dragging, slots | The existing desktop layout: `ITEMS` and `DEFAULT_LAYOUT` in `src/libs/desktop/layout.js` (`youtube`, `instagram`; `category: 'creator'`) |
| Gallery category, adding and removing | `src/components/settings/WidgetsPane.jsx` (the `CATEGORIES` list) |
| Accounts UI (add, connect, switch, disconnect, refresh interval) | `src/components/settings/CreatorAccounts.jsx`, inside each widget's gallery section |
| Widget UI | `src/components/creator/`: `CreatorWidget.jsx` (shared shell), `YouTubeWidget.jsx`, `InstagramWidget.jsx` |
| State, scheduler, cache | `src/libs/creator/creatorStore.js` (hooks in `useCreator.js`) |
| Storage | iWebDB v7: `creator_accounts` and `creator_snapshots` (`creatorDb.js`), plus the `creator_widgets` pref (`creatorPrefs.js`) |
| Sign-in | `src/libs/creator/creatorAuth.js` |
| Server | `api/_creatorProxy.js`, served by `api/creator.js` and `api/creator-callback.js` (and the Vite dev middleware) |

### Loading

- The widget code loads only when a creator widget is on the desktop. Both are `React.lazy` in `App.jsx`, and `DesktopItem` renders nothing for a hidden item.
- Until someone adds a creator widget, iWeb makes no creator API calls, and the startup bundle doesn't change.
- The account-management code ships with the Settings chunk, which is already lazy.

### Sizes

- **Small:** one headline number.
- **Medium:** four metrics; Details flips to four more, in place.
- **Large:** both, plus a daily-views chart (YouTube owner) or recent posts (Instagram).

### Controls

- Refresh, and an options menu with: switch account, Refresh Now, Show Details, Manage Accounts…, Remove Widget.
- The desktop right-click menu (sizes, Edit Widgets, Remove Widget) works as for every widget.

## Supported metrics

### Sources

The YouTube and Google facts below were checked against the official pages on 2 November 2026:

- YouTube Data API `channels.list`
- YouTube Analytics `reports.query`, plus its metrics and data-model pages
- Google OAuth 2.0 for web server apps

The Instagram facts come from developers.facebook.com:

- Instagram Platform
- Business Login for Instagram
- the access-token and refresh references
- the Graph API v22 changelog (retirement of `impressions`)

The Instagram pages could not be opened directly during that check, so the Instagram rows rest on search summaries of the official pages. Re-check them against the current docs, especially the insights metric list.

### Matrix

| Platform | Metric | Public API | Owner sign-in | Notes |
| --- | --- | --- | --- | --- |
| YouTube | Subscribers | Yes (`statistics.subscriberCount`) | Not required | YouTube rounds it down to 3 significant figures. Channels can hide it (`hiddenSubscriberCount`); the widget then shows "Hidden". |
| YouTube | Total views | Yes (`statistics.viewCount`) | Not required | Lifetime, all videos. |
| YouTube | Videos | Yes (`statistics.videoCount`) | Not required | Public videos only, even for the owner. |
| YouTube | Views, last 28 days | No | Yes (`views`) | YouTube Analytics, Pacific Time days. Data lags 48–72 hours, so the widget shows the last day YouTube has finished ("To 30 Oct"). |
| YouTube | Watch time | No | Yes (`estimatedMinutesWatched`) | Shown in hours. |
| YouTube | Subscribers gained, lost, net | No | Yes (`subscribersGained`, `subscribersLost`) | Exact for the period, unlike the rounded public count. |
| YouTube | Average view duration | No | Yes (`averageViewDuration`) | Seconds; shown as m:ss. |
| YouTube | Estimated revenue | **Never** | Yes, with `yt-analytics-monetary.readonly` | Only for channels in the YouTube Partner Program; others get HTTP 403, shown as "Unavailable", never 0. In the currency chosen per account (default from the locale; YouTube converts at daily rates). |
| Instagram | Followers, posts | No (needs the owner's sign-in) | Yes (`followers_count`, `media_count`) | |
| Instagram | Reach (28d) | No | Yes (`reach`, `total_value`) | |
| Instagram | Views (28d) | No | Yes (`views`, `total_value`) | `impressions` was retired on 21 April 2025 and is not used; views are never relabelled impressions. |
| Instagram | Accounts engaged, interactions, profile visits, link taps (28d) | No | Yes, where Instagram provides them | `accounts_engaged`, `total_interactions`, `profile_views`, `profile_links_taps`. Unconfirmed names: each is requested separately if a combined request fails, and any Instagram refuses shows as "Not provided". Some need 100+ followers. |
| Instagram | Recent posts | No | Yes (`like_count`, `comments_count`) | Likes are missing when the owner hides them. |
| Instagram | Revenue | No | **No** | The Instagram API has no earnings data, so the widget has no revenue field. |

Growth indicators ("+1.2K 7d") are worked out on the device from saved snapshots, and labelled as such in their tooltips. See [Refreshing, caching and history](#refreshing-caching-and-history).

## Setup

All credentials live on the server: Vercel environment variables, or `.env` for `npm run dev`. The browser bundle contains none of them; `noSecrets.test.js` guards this. See `.env.example` for every variable.

A missing variable switches its feature off: the widgets and Settings say what isn't set up, and nothing crashes.

### 1. Sealing key (needed for any sign-in)

`CREATOR_TOKEN_KEY` must be at least 32 random characters, for example from `openssl rand -base64 48`.

- It encrypts the connection each browser keeps.
- Rotating it disconnects every account. People see "Action needed" and reconnect.

### 2. Redirect URI

Set `CREATOR_REDIRECT_URI` to `https://<your-vercel-domain>/api/creator-callback`. Register exactly this URI with both Google and Meta.

- Sign-in for the website works only on that domain. Vercel preview URLs differ.
- The extension works from any install, because its own `chromiumapp.org` address is reached through this callback.

### 3. YouTube

1. In [Google Cloud Console](https://console.cloud.google.com/), create or choose a project.
2. Enable the **YouTube Data API v3** and the **YouTube Analytics API**.
3. **Public lookup:** under Credentials, create an API key. Restrict it to *YouTube Data API v3*; no application restriction is needed, because it is used server-side only. Set `YOUTUBE_API_KEY`.
4. **Owner sign-in:**
   1. Configure the OAuth consent screen, with these scopes:
      - `.../auth/youtube.readonly`
      - `.../auth/yt-analytics.readonly`
      - `.../auth/yt-analytics-monetary.readonly`
   2. Create an OAuth client ID of type **Web application**, with the redirect URI from step 2. For local development, add `http://localhost:5173/api/creator-callback` as well.
   3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
5. While the app's publishing status is **Testing**:
   - only listed test users can connect;
   - Google expires refresh tokens after 7 days, so people would have to reconnect weekly.

   Publish the app (verification is required for these sensitive scopes) for normal use.

Quota: the default daily quota is 10,000 units.

- A public lookup costs 1 unit. It is cached at the CDN for 10 minutes, so many people watching one channel cost one call.
- An owner refresh costs 1 Data API unit plus 2–3 Analytics queries.

### 4. Instagram

1. At [Meta for Developers](https://developers.facebook.com/), create an app (Business type) and add **Instagram → API setup with Instagram login**.
2. Under Business login settings, add the redirect URI from step 2. Meta requires https, so test locally through a tunnel or a deployed preview.
3. Set `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET` (the *Instagram* app ID and secret).
4. Permissions used: `instagram_business_basic` and `instagram_business_manage_insights`.
5. **Access levels:**
   - Standard Access: only accounts with a role on the app (added as testers) can connect.
   - Anyone else: you need **Advanced Access**, which requires App Review (with a screencast) and **Business Verification**.
6. Optional: `INSTAGRAM_API_VERSION` pins the Graph API version (default `v25.0`).

### 5. Extension builds

The extension calls the same server. `src/libs/apiBase.js` takes its origin from `VITE_API_ORIGIN`, or from the existing `VITE_UNSPLASH_PROXY_URL` that the release workflow already sets, so no new build variable is needed.

The manifest gains the `identity` permission, for `chrome.identity.launchWebAuthFlow`. Chrome shows no install warning for it, and the extension's ID (and so its data) doesn't change.

### 6. Development without credentials

Run `VITE_CREATOR_MOCK=1 npm run dev`. The creator API then answers with clearly labelled sample data ("Sample Channel…") from `src/libs/creator/creatorMock.js`, so the UI can be worked on.

The mock is loaded behind `import.meta.env.DEV`, which every production build replaces with `false`. The file is therefore never in `dist/`. This was checked: `dist/` has no `creatorMock`.

## Security and privacy

### Why a server

- **Client secrets:** Google's and Meta's must stay secret.
- **Instagram:** its code exchange and long-lived-token exchange both require the app secret.
- **Existing setup:** iWeb already runs serverless functions on Vercel (`/api/*`), so the creator API is one more. It is **stateless**: no database, nothing stored, no request bodies logged.

### Sign-in

The flow is the OAuth 2.0 authorization code flow:

1. The app creates a PKCE verifier (S256) and a random `state`, both held only in memory for that sign-in.
2. The server builds the consent URL (client IDs stay on the server) with the minimum scopes:
   - YouTube: `youtube.readonly` plus `yt-analytics.readonly`.
   - With revenue: `youtube.readonly` plus `yt-analytics-monetary.readonly`, instead of the plain analytics scope. The monetary scope includes the non-monetary reports.
   - Instagram: `instagram_business_basic` plus `instagram_business_manage_insights`.
3. The provider redirects to `/api/creator-callback`. It sends the result only to:
   - `https://<extension-id>.chromiumapp.org/` (for the extension; the ID comes from `state` and must be 32 letters a–p), or
   - the iWeb site's own origin, through a `BroadcastChannel` on a page served with a hash-locked CSP.

   It never redirects to an arbitrary URL.
4. The app checks that `state` matches, then sends the code and the verifier to the server. The server exchanges them, adding the client secret.

PKCE: Google validates it. Instagram Login doesn't document PKCE, so for Instagram the protection is `state` plus the server-held secret.

### Tokens

- **Never in the browser in usable form.** The long-lived credential (Google's refresh token, Instagram's 60-day token) is encrypted on the server with AES-256-GCM, bound to the platform, using `CREATOR_TOKEN_KEY`.
- **The sealed grant.** The browser stores only this encrypted value in IndexedDB. It can't be read, and it can't be used against Google or Meta directly.
- **Short-lived tokens.** Access tokens are created on the server for each refresh and never returned. A renewed Instagram token comes back sealed.
- **Kept out of the UI.** The grant stays inside `creatorStore.js`; UI state only has `connected: true`.
- **Kept out of backups.** The creator stores are not part of backups.

**Honest limitation:** anyone who copies a sealed grant out of the browser profile can still use it through iWeb's server until it is revoked. Client-side storage is not server-grade secret storage. The sealing protects the raw tokens, lets the operator invalidate every grant by rotating the key, and makes a stolen grant useless anywhere but iWeb's API.

### Other safeguards

- **Disconnect:** deletes the account, its snapshots and the widget's selection on the device.
  - Google: it also asks Google to revoke the token.
  - Instagram: it offers no revoke API, so Settings tells people to remove iWeb under Instagram → Settings → Apps and websites.
- **CORS:** credentialed `POST` operations accept only the extension (`chrome-extension://`), localhost, the redirect URI's origin and `CREATOR_ALLOWED_ORIGINS`. Public lookups are open, and cached.
- **Input checks:** every input is validated: channel input, state, challenge, verifier, code, platform, currency, and body size (16 KB).
- **Rate limiting:** per IP and per function instance. Best effort, since Vercel runs several instances. Google and Meta enforce their own limits on top.
- **Privacy:**
  - **What's fetched:** only what the widgets show.
  - **Where it goes:** analytics pass through iWeb's own server on the way to the browser. They aren't stored or logged there, and nothing goes to third parties.

## Refreshing, caching and history

### Shared scheduler

There is one scheduler (`creatorStore.js`) for both widgets:

- **One timer per account.** It runs only while a widget showing that account is mounted, the tab is visible and the browser is online. Hidden widgets, background tabs and accounts no widget shows cost nothing.
- **Interval:** set in Settings → Widgets: 15, 30 (default) or 60 minutes, 3 hours, or manual only.
- **No duplicate requests:**
  - **In one tab:** simultaneous refreshes share one request.
  - **Across tabs:** a Web Lock per account. A tab that waited re-reads what the other tab stored, and tabs are told about changes through a `BroadcastChannel`.
- **Manual refresh:** within 15 s of an update, it's answered from the cache.
- **Switching accounts:** shows the cached data at once and fetches only if that account is due.

### Failures and backoff

- **Retries back off:** 1, 2, 5, 15, then 60 minutes, or the server's `Retry-After` (quota, rate limits).
- **Errors the person has to fix** (revoked access, missing permission, personal Instagram account, deleted channel) are never retried automatically.
- **Data is never lost to a failure.** A failed refresh keeps the last data on screen and in storage.

### Snapshots and growth

- **What's saved:** after each successful refresh, the lifetime counters (subscribers, total views, videos; followers, posts) are saved as a snapshot.
- **Retention:**
  - **Last 48 hours:** at most one snapshot per hour.
  - **Older:** at most one per day.
  - **Limits:** snapshots older than 400 days are dropped, and each account keeps at most 500 in all.
- **How changes are worked out:**
  - Since the previous update.
  - Over 7 days: needs a snapshot within a day of 7 days ago.
  - Over 28 days: needs one within two days of 28 days ago.
  - Since tracking began: once the first snapshot is a day old.
- **When there isn't enough history**, nothing is shown, or "Not enough history" in the large size. Period metrics the APIs report (28-day views, reach…) are shown as reported and never diffed, and no history from before tracking began is ever invented.

## Errors and states

| Situation | What the widget shows |
| --- | --- |
| No account yet | "Add a YouTube channel…" or "Connect an Instagram Business or Creator account…", with a button to Settings |
| Server not set up for this platform | "…isn't set up on this iWeb server yet." |
| Server unreachable | "Can't reach iWeb's server", with Retry |
| Refreshing | A spinning refresh button and "Updating…" |
| Refresh failed (network, quota, upstream) | The last numbers stay, with a yellow dot: "Not updated · 42 min ago", and the reason as a tooltip |
| Access revoked or expired, permission missing | Red dot, "Action needed", and Fix (opens Settings on that widget, with Reconnect…) |
| Public channel: owner-only metric | "Owner only", with a tooltip on how to connect |
| Revenue not requested, or channel not in the Partner Program | "Not allowed" or "Unavailable", never 0 |
| Hidden subscriber count | "Hidden" |
| Instagram metric not provided | "Not provided" |
| Personal Instagram account | "Only Instagram Business and Creator accounts can be connected…" |
| Channel not found, `/c/` custom link | An explanation in Settings, asking for the @handle |
| Sign-in cancelled, or popup blocked | No error for a cancel; a clear message for a blocked popup |

## Known limitations

- **YouTube `/c/` links:** custom links can't be resolved by `channels.list`. People are asked for the @handle; iWeb doesn't use `search.list`, which costs 100× the quota and can match the wrong channel.
- **YouTube subscriber counts are rounded**, so growth of the public count moves in steps. Owner analytics give exact gains and losses.
- **YouTube Analytics lags 48–72 hours.** The 28-day window is labelled with the last finished day.
- **Instagram metric names** for insights couldn't be confirmed directly against the reference during development. The widget asks for each and shows "Not provided" for any Instagram refuses.
- **Instagram without App Review:** only app testers can connect until the app has Advanced Access.
- **Website sign-in** works only on the domain of `CREATOR_REDIRECT_URI`. The extension works anywhere.
- **The website popup can't be watched for closing:** the providers' pages cut the link to it. Waiting ends with a result, Cancel, or a 5-minute timeout.
- **Rate limiting** is per server instance (best effort).
- **Look:** the widgets use iWeb's dark-tinted Liquid Glass in both light and dark mode, like the other widgets, so text stays readable on any wallpaper.

## Testing

```bash
npm test     # all suites; creator ones under src/libs/creator/__tests__ and src/libs/desktop/__tests__/creatorLayout.test.js
npm run build
```

| Suite | Covers |
| --- | --- |
| `creatorProxy.test.js` | Grant sealing and tampering; config; public lookup (handle, not found, hidden, quota, no key leaks); consent URLs and minimum scopes; callback redirect allow-list and CSP; YouTube exchange and fetch (revenue 403 → unavailable, no revenue without scope, `invalid_grant` → revoked, forged grants, revoke); Instagram exchange, personal accounts, metric fallback, token renewal, expiry; CORS; methods; rate limiting; Pacific days |
| `creatorStore.test.js` | Adding and connecting; grants kept out of UI state; deduplicated refreshes; manual-refresh gap; failures keep data and back off; `Retry-After`; no retry for action-needed errors; snapshots; renewed grants; scheduling only for watched accounts; removal deleting data and revoking |
| `creatorAuth.test.js` | PKCE (RFC 7636 vector); state validation; cancel and failure; extension or website target |
| `snapshots.test.js` | Retention; growth windows only from nearby snapshots; hidden counts |
| `channelInput.test.js` | Handles, IDs, links, `/c/` and invalid input |
| `creatorLayout.test.js` | Hidden by default; older saved layouts unchanged; positions and sizes kept; not offered in the desktop menu |
| `noSecrets.test.js` | No server secrets or `process.env` in `src/`; no logging of grants or tokens; pref validation |
| `repository.test.js` | The v7 upgrade keeps existing wallpapers and fonts |

### Manual check

With `VITE_CREATOR_MOCK=1 npm run dev`:

1. Open Settings → Widgets → Creator Widgets.
2. Add a channel, then Connect with Google… (with revenue) and Connect with Instagram….
3. Add both widgets to the desktop.

Checked this way at 1920×1080, 1366×768, 1280×720, and 1280×720 at 80% and 125% zoom:

- the cards stay on screen without overlapping or overflowing;
- dragging and slot placement work as for other widgets;
- the stale, action-needed and empty states render;
- nothing loads or calls the creator API until a creator widget is added.
