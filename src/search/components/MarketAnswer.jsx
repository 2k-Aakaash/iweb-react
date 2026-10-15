import Sparkline from '../../components/widgets/shared/Sparkline';
import {
  SOVEREIGN_GRAMS,
  displayCurrency,
  formatChange,
  formatChangePercent,
  formatPrice,
  getMetalPrefs,
  getSessionState,
  isMetal,
  metalPrice
} from '../../libs/markets/marketService';

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
const MOD_KEY = isMac ? '⌘' : 'Ctrl';

const FEEDBACK_TEXT = {
  added: '✓ Added to watchlist',
  exists: 'Already in watchlist',
  failed: 'Couldn’t add to watchlist'
};

const SOURCE_LABEL = {
  comex: 'International (COMEX)',
  'daily-spot': 'Daily spot'
};

const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

function formatDay(isoDate) {
  const date = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(date.getTime()) ? isoDate : DAY_FORMAT.format(date);
}

// Gold is quoted per gram (sovereign = 8 g of 22K), silver per kg, as retail estimates.
function metalTitle(symbol, request, purity) {
  if (symbol === 'SILVER') return 'Silver · per kg · retail estimate';
  if (request.sovereign) return `Gold · sovereign (${SOVEREIGN_GRAMS} g 22K) · retail estimate`;
  return `Gold · ${purity} per gram · retail estimate`;
}

function metalFigures(quote, request, { purity, dutyPct }) {
  const retail = (grams, karat) => metalPrice(quote.price, { grams, purity: karat, mode: 'retail', dutyPct });
  const spot = (grams) => metalPrice(quote.price, { grams, mode: 'spot' });
  if (quote.symbol === 'SILVER') {
    return { value: formatPrice(retail(1000)), detail: [`${formatPrice(retail(1))}/g`, `Spot ${formatPrice(spot(1000))}/kg`] };
  }
  const sovereign = formatPrice(retail(SOVEREIGN_GRAMS, '22K'));
  const spotPerGram = `Spot 24K ${formatPrice(spot(1))}/g`;
  if (request.sovereign) {
    return { value: sovereign, detail: [`22K ${formatPrice(retail(1, '22K'))}/g`, spotPerGram] };
  }
  return {
    value: formatPrice(retail(1, purity)),
    detail: [`Sovereign (${SOVEREIGN_GRAMS} g 22K) ${sovereign}`, spotPerGram]
  };
}

function quoteFigures(quote) {
  // Indices have no currency symbol, like the exchanges show them.
  const currency = displayCurrency(quote.symbol) === null ? null : quote.currency;
  const detail = [`Prev close ${formatPrice(quote.previousClose, { currency })}`];
  if (typeof quote.change === 'number') detail.unshift(formatChange(quote.change));
  return { value: formatPrice(quote.price, { currency }), detail };
}

function statusParts(quote, receivedAt) {
  const parts = [];
  if (quote.source === 'daily-spot') {
    parts.push(quote.date ? `${SOURCE_LABEL['daily-spot']} · ${formatDay(quote.date)}` : SOURCE_LABEL['daily-spot']);
  } else if (quote.source) {
    parts.push(SOURCE_LABEL[quote.source]);
  }
  const session = getSessionState(quote.session, receivedAt);
  if (session === 'open') parts.push('Market open · delayed');
  if (session === 'closed') parts.push('Market closed');
  return parts;
}

function headline({ request, symbol, name, status }, { metal, purity, ticker }) {
  if (metal) return metalTitle(symbol, request, purity);
  // Typed tickers have no company name (the quote endpoint returns none): show "RELIANCE".
  if (ticker && name === symbol) return ticker;
  // A stock name that couldn't be looked up shows what was typed.
  return name || (status === 'error' && request.query ? `“${request.query}”` : null);
}

// "a · b · c" with the currency card's dot spacing.
function withDots(parts) {
  return parts.flatMap((part, i) => (i ? [<span key={`dot-${i}`} className="sp-cc-dot">·</span>, part] : [part]));
}

export const MarketAnswer = ({ ref, answer, isSelected, onHover, onOpen }) => {
  const { request, status, quote, symbol, exchange, error, receivedAt, feedback, addToWatchlist } = answer;
  const ready = status === 'ready';
  const metal = Boolean(symbol) && isMetal(symbol);
  const prefs = metal ? getMetalPrefs() : null;
  const purity = request.purity || prefs?.purity;
  const ticker = !metal && symbol && !symbol.startsWith('^') ? symbol.replace(/\.(NS|BO)$/, '') : null;
  const title = headline(answer, { metal, purity, ticker });

  const figures = ready ? (metal ? metalFigures(quote, request, { ...prefs, purity }) : quoteFigures(quote)) : null;
  const statusLine = ready ? statusParts(quote, receivedAt) : [];
  const values = ready ? quote.points.map((point) => point[1]).filter(Number.isFinite) : [];
  const source = quote?.source === 'daily-spot'
    ? 'Daily spot · fawazahmed0 currency-api · Not investment advice'
    : 'Delayed · Yahoo Finance · Not investment advice';

  return (
    <div
      ref={ref}
      id="sp-mk-answer"
      className={`sp-cc-card sp-mk-card ${isSelected ? 'selected' : ''}`}
      role="group"
      aria-label={title ? `Market quote, ${title}` : 'Market quote'}
      aria-current={isSelected ? 'true' : undefined}
      aria-busy={status === 'loading'}
      onMouseEnter={onHover}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onOpen}
    >
      <div className="sp-cc-head">
        <span className={`sp-cc-badge sp-mk-badge ${metal ? symbol.toLowerCase() : ''}`}>{exchange}</span>
        <span className="sp-cc-names">
          {title || <span className="sp-cc-skel short" aria-hidden="true" />}
          {ticker && title !== ticker && <span className="sp-mk-ticker">{ticker}</span>}
        </span>
        <span className="sp-cc-aside">
          {symbol && !feedback && (
            <span className="sp-cc-hint">
              <kbd className="sp-cc-kbd">↵</kbd> Open in Markets
            </span>
          )}
          <span
            className={`sp-cc-feedback ${feedback === 'failed' ? 'failed' : ''}`}
            role="status"
            aria-live="polite"
          >
            {feedback ? FEEDBACK_TEXT[feedback] : ''}
          </span>
        </span>
      </div>

      <div className="sp-mk-main">
        <span className="sp-mk-figure" role="status" aria-live="polite" aria-atomic="true">
          {ready && (
            <>
              <span className="sp-mk-value">{figures.value}</span>
              {typeof quote.changePercent === 'number' && (
                <span className={`sp-mk-change ${quote.direction}`}>{formatChangePercent(quote.changePercent)}</span>
              )}
            </>
          )}
          {status === 'error' && <span className="sp-cc-error">{error}</span>}
          {status === 'loading' && <span className="sp-cc-skel value" aria-hidden="true" />}
        </span>
        {ready && (
          <Sparkline
            className={`sp-mk-spark ${quote.direction}`}
            values={values}
            baseline={typeof quote.previousClose === 'number' ? quote.previousClose : null}
            width={120}
            height={32}
          />
        )}
      </div>

      {status !== 'error' && (
        <>
          <div className="sp-mk-detail">
            {ready ? withDots(figures.detail) : <span className="sp-cc-skel" aria-hidden="true" />}
          </div>
          <div className="sp-cc-meta">
            {ready ? (
              <>
                {withDots(statusLine)}
                {quote.stale && (
                  <>
                    {statusLine.length > 0 && <span className="sp-cc-dot">·</span>}
                    <span className="sp-cc-offline">Offline · last known price</span>
                  </>
                )}
              </>
            ) : (
              <span className="sp-cc-skel short" aria-hidden="true" />
            )}
          </div>
        </>
      )}

      <div className="sp-cc-footer">
        <span className="sp-mk-source">{source}</span>
        {symbol && (
          <button
            type="button"
            className="sp-cc-action"
            onClick={(e) => {
              e.stopPropagation();
              addToWatchlist();
            }}
          >
            Add to watchlist
            <kbd className="sp-cc-kbd">{MOD_KEY} ↵</kbd>
          </button>
        )}
      </div>
    </div>
  );
};
