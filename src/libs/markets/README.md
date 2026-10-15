# Markets & metals (`src/libs/markets/`)

Data layer for the **Gold & Silver card**, the **Markets card**, the **Markets app** (modal) and
**Spotlight** market answers. Plain JS; components never call `fetch` for market data directly.

## Data flow

```
browser ──► /api/market (api/market.js on Vercel · Vite middleware in dev)
               └─► Yahoo Finance chart / spark / search (unofficial, server-side, CDN-cached)
browser ──► cdn.jsdelivr.net @fawazahmed0/currency-api   (daily gold/silver spot fallback)
```

- `apiUrl('/api/market')` (`src/libs/apiBase.js`): same origin on the website/dev server; the
  extension uses `VITE_API_ORIGIN` or the origin of `VITE_UNSPLASH_PROXY_URL`.
- Responses are cached per symbol in localStorage (`mkt:*`). TTL 60 s while that symbol's session
  is open, 15 min when closed, 30 min for charts ≥ 1M. Network failures return the last cached
  value with `stale: true`.
- Data is **delayed and informational**. Always show the source and "Not investment advice".

## Symbols

- Real Yahoo symbols: `^NSEI` (NIFTY 50), `^BSESN` (SENSEX), `^NSEBANK`, `^CNXIT`, `^INDIAVIX`,
  `RELIANCE.NS`, `TCS.BO`, …
- Virtual: `GOLD`, `SILVER`. These are **INR per gram** (24K gold / fine silver), built from COMEX front-month
  futures (`GC=F`, `SI=F`) × `USDINR=X` ÷ 31.1035. When the proxy is unavailable they come from the
  daily spot feed. The two sources can differ, by about 0.2% for gold and as much as about 5% for silver, so **always label the
  source** (`quote.source`: `'comex'` → "International (COMEX)", `'daily-spot'` → "Daily spot").
- Indices are displayed **without** a currency symbol (`displayCurrency(symbol)` → `null`).

## API (`marketService.js`)

| Function | Returns |
|---|---|
| `getQuotes(symbols, { signal, force, names })` | `{ [symbol]: Quote }` (omits symbols with no data; throws `MarketError` only if nothing) |
| `getChart(symbol, rangeId, { signal, force })` | `{ meta, points: [[tSec, value]], fetchedAt, stale }` |
| `searchSymbols(query, { signal })` | `[{ symbol, name, exchange, type }]` local indices/metals first, then NSE/BSE, then others |
| `getMetalQuotes({ signal, force })` | `{ GOLD: Quote, SILVER: Quote, source, stale }` (COMEX, falling back to daily spot) |
| `getSessionState(session, now)` | `'open' \| 'closed' \| 'unknown'` |
| `metalPrice(inrPerGram, { grams, purity, mode, dutyPct })` | INR. Mode is `'retail'` (× (1+duty%) × 1.03 GST) or `'spot'` |
| `getMetalPrefs()` / `setMetalPrefs(patch)` | `{ mode: 'retail'\|'spot', dutyPct, purity: '24K'\|'22K'\|'18K' }`, emits `metals:prefs` |
| `getWatchlist()` / `setWatchlist(list)` / `addToWatchlist(item)` / `removeFromWatchlist(symbol)` | `[{ symbol, name }]`, emits `markets:watchlist` |
| `openMarkets(symbol?)` | dispatches `markets:open` `{ symbol }`; App opens the Markets app |
| `formatPrice(v, { currency, compact, digits })` | `₹1,26,941.40`, `22,852.00` (currency `null`), `₹1.81L` |
| `formatChangePercent(pct)` / `formatChange(delta)` | `▲ 0.86%` / `+195.25`, `−12.40` |
| `isMarketConfigured()` | false when no API origin is resolvable |

```
Quote = { symbol, name, currency ('INR'|null), price, previousClose, change, changePercent,
          direction: 'up'|'down'|'flat', points: [[tSec, value]] (intraday), session: { start, end } (epoch s),
          fetchedAt, stale, unit?: 'g', source?: 'comex'|'daily-spot', date?: 'YYYY-MM-DD' }
Chart meta = { symbol, name, currency, unit?, exchange, instrumentType, timezone, price,
               previousClose (real previous close; 1D only, else null), rangeBaseline (reference for
               the range's change), dayChangePercent, open (1D only), dayHigh, dayLow, volume,
               fiftyTwoWeekHigh, fiftyTwoWeekLow, marketTime, session }
CHART_RANGES = 1D 5D 1M 6M YTD 1Y 5Y (ids: 1d 5d 1mo 6mo ytd 1y 5y)
MarketError.code: NOT_CONFIGURED | OFFLINE | NETWORK | RATE_LIMITED | NOT_FOUND | UPSTREAM | BAD_RESPONSE | BAD_RANGE
```

Gold units used in the UI: per gram (24K / 22K / 18K), **sovereign = 8 g of 22K**, silver per kg.

## Smart Stack card contract (`src/components/widgets/`)

- A page is `{ id, label, Component }` in `SmartStack.jsx`. Components receive `{ active, onExpandedChange }`.
  Poll only while `active` and `document.visibilityState === 'visible'`.
- Cards reuse the **`cw-*` card design system** in `src/styles/widgets.css` (`cw-card` size, glass and
  hover; `cw-mood-up/down`; `cw-header`, `cw-value`, `cw-change`, `cw-shimmer`, `cw-divider`, `cw-footer`, …)
  and add their own prefixed classes in their own CSS file.
- Shared: `shared/Sparkline.jsx` (`values`, `baseline`) and `shared/useCardExpand.js`
  (GSAP expand/collapse and click-outside, identical to Weather/Currency).
- Interactive descendants carry `data-stack-no-flip` and stop click propagation.
