import { ATTRIBUTION, formatMoney, formatRate, getCurrency, getCurrencySymbol } from '../../libs/currency/currencyService';

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
const MOD_KEY = isMac ? '⌘' : 'Ctrl';

const STAMP_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
});

const FEEDBACK_TEXT = {
  copied: '✓ Copied',
  'copy-failed': 'Couldn’t copy',
  saved: '✓ Saved to widget'
};

// Grouped number without a currency symbol: "100", "8,342.50", "0.0067".
function formatAmount(value, { fixed = false } = {}) {
  const abs = Math.abs(value);
  const digits = abs >= 1 || abs === 0 ? 2 : abs >= 0.01 ? 4 : 6;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: fixed ? 2 : 0,
    maximumFractionDigits: digits
  });
}

function timeAgo(ts, now) {
  const minutes = Math.max(0, Math.floor((now - ts) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export const CurrencyAnswer = ({ ref, answer, isSelected, onHover }) => {
  const { conversion, status, data, error, receivedAt, feedback, copy, saveToWidget } = answer;
  const from = getCurrency(conversion.from);
  const to = getCurrency(conversion.to);

  return (
    <div
      ref={ref}
      id="sp-cc-answer"
      className={`sp-cc-card ${isSelected ? 'selected' : ''}`}
      role="group"
      aria-label={`Currency conversion, ${conversion.amount} ${conversion.from} to ${conversion.to}`}
      aria-current={isSelected ? 'true' : undefined}
      aria-busy={status === 'loading'}
      onMouseEnter={onHover}
      onMouseDown={(e) => e.preventDefault()}
      onClick={copy}
    >
      <div className="sp-cc-head">
        <span className="sp-cc-badge">Currency</span>
        <span className="sp-cc-names">
          {from?.name} → {to?.name}
        </span>
        <span className="sp-cc-aside">
          {status === 'ready' && !feedback && (
            <span className="sp-cc-hint">
              <kbd className="sp-cc-kbd">↵</kbd> Copy
            </span>
          )}
          <span
            className={`sp-cc-feedback ${feedback === 'copy-failed' ? 'failed' : ''}`}
            role="status"
            aria-live="polite"
          >
            {feedback ? FEEDBACK_TEXT[feedback] : ''}
          </span>
        </span>
      </div>

      <div className="sp-cc-value" role="status" aria-live="polite" aria-atomic="true">
        {status === 'ready' && formatMoney(data.result, data.to)}
        {status === 'error' && <span className="sp-cc-error">{error}</span>}
        {status === 'loading' && <span className="sp-cc-skel value" aria-hidden="true" />}
      </div>

      <div className="sp-cc-pair">
        {status === 'ready' ? (
          <>
            <span className="sp-cc-flag" aria-hidden="true">{from ? getCurrencySymbol(from.code) : ''}</span>
            {formatAmount(data.amount)} {data.from}
            <span className="sp-cc-eq">=</span>
            <span className="sp-cc-flag" aria-hidden="true">{to ? getCurrencySymbol(to.code) : ''}</span>
            {formatAmount(data.result, { fixed: true })} {data.to}
          </>
        ) : status === 'error' ? (
          <>
            <span className="sp-cc-flag" aria-hidden="true">{from ? getCurrencySymbol(from.code) : ''}</span>
            {formatAmount(conversion.amount)} {conversion.from}
            <span className="sp-cc-eq">→</span>
            <span className="sp-cc-flag" aria-hidden="true">{to ? getCurrencySymbol(to.code) : ''}</span>
            {conversion.to}
          </>
        ) : (
          <span className="sp-cc-skel" aria-hidden="true" />
        )}
      </div>

      {status !== 'error' && (
        <div className="sp-cc-meta">
          {status === 'ready' ? (
            <>
              1 {data.from} = {formatRate(data.rate)} {data.to}
              <span className="sp-cc-dot">·</span>
              {data.stale ? (
                <span className="sp-cc-offline">
                  Offline · rates from {STAMP_FORMAT.format(new Date(data.updatedAt))}
                </span>
              ) : (
                <>Updated {timeAgo(data.updatedAt, receivedAt)}</>
              )}
            </>
          ) : (
            <span className="sp-cc-skel short" aria-hidden="true" />
          )}
        </div>
      )}

      <div className="sp-cc-footer">
        <a
          className="sp-cc-attribution"
          href={ATTRIBUTION.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          {ATTRIBUTION.label}
        </a>
        <button
          type="button"
          className="sp-cc-action"
          onClick={(e) => {
            e.stopPropagation();
            saveToWidget();
          }}
        >
          Use in widget
          <kbd className="sp-cc-kbd">{MOD_KEY} ↵</kbd>
        </button>
      </div>
    </div>
  );
};
