import { typeLabel } from './format';

// Sidebar search for the Markets app: the field at the top of the sidebar and the results
// list that replaces the watchlist while a query is typed. Data comes from useSymbolSearch.

export function SearchField({ value, onChange, inputRef, resultsId, onSubmit, onArrowDown }) {
  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown' && value.trim()) {
      e.preventDefault();
      onArrowDown();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onSubmit();
    }
  };

  const clear = () => {
    onChange('');
    inputRef.current?.focus();
  };

  return (
    <div className="mk-search" role="search">
      <svg className="mk-search-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="m10.6 10.6 3.4 3.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        className="mk-search-input"
        placeholder="Search NSE / BSE…"
        aria-label="Search NSE and BSE stocks, indices and metals"
        aria-controls={value.trim() ? resultsId : undefined}
        aria-keyshortcuts="/ Control+F Meta+F Control+K Meta+K"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {value && (
        <button type="button" className="mk-search-clear" aria-label="Clear search" onClick={clear}>
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="m5 5 6 6m0-6-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function SearchResults({ id, containerRef, search, watchSymbols, onOpen, onAdd, onExitToInput }) {
  const { query, status, results, error } = search;
  const loading = status === 'loading';

  // ArrowUp/ArrowDown move between results; ArrowUp on the first returns to the field.
  const handleKeyDown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const button = e.target.closest('.mk-result-open');
    if (!button) return;
    const buttons = [...e.currentTarget.querySelectorAll('.mk-result-open')];
    const index = buttons.indexOf(button);
    e.preventDefault();
    if (e.key === 'ArrowDown') buttons[Math.min(buttons.length - 1, index + 1)]?.focus();
    else if (index <= 0) onExitToInput();
    else buttons[index - 1].focus();
  };

  // Keep focus on the row when its "+" turns into a check mark.
  const handleAdd = (e, result) => {
    e.currentTarget.closest('li')?.querySelector('.mk-result-open')?.focus();
    onAdd(result);
  };

  let message = '';
  if (!results.length) {
    if (loading) message = 'Searching…';
    else if (status === 'error') message = error;
    else if (query.length < 2) message = 'Keep typing to search NSE and BSE.';
    else message = `No matches for “${query}”. Try a company name or NSE symbol.`;
  }
  const countText = loading
    ? ''
    : status === 'error'
      ? error
      : `${results.length} ${results.length === 1 ? 'result' : 'results'}`;

  return (
    <div id={id} ref={containerRef} className="mk-results" aria-busy={loading || undefined}>
      <h3 className="mk-section-title">Results</h3>
      {results.length > 0 && (
        <ul
          className={`mk-result-list${loading ? ' is-stale' : ''}`}
          aria-label={`Search results for ${query}`}
          onKeyDown={handleKeyDown}
        >
          {results.map((result, index) => {
            const added = watchSymbols.has(result.symbol);
            const details = [result.symbol, result.exchange, typeLabel(result.type)].filter(Boolean);
            const meta = details.join(' · ');
            return (
              <li key={result.symbol} className={`mk-result${index === 0 ? ' is-first' : ''}`}>
                <button
                  type="button"
                  className="mk-result-open"
                  aria-label={`${result.name}, ${details.join(', ')}. Show details`}
                  onClick={() => onOpen(result)}
                >
                  <span className="mk-result-name">{result.name}</span>
                  <span className="mk-result-meta">{meta}</span>
                </button>
                {added ? (
                  <span className="mk-result-added" role="img" aria-label={`${result.name} is in your watchlist`}>
                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="mk-result-add"
                    aria-label={`Add ${result.name} to watchlist`}
                    title="Add to watchlist"
                    onClick={(e) => handleAdd(e, result)}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <path d="M8 3.5v9M3.5 8h9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {message && <p className={`mk-results-message${status === 'error' ? ' is-error' : ''}`}>{message}</p>}
      <p className="mk-sr-only" aria-live="polite" aria-atomic="true">{countText}</p>
    </div>
  );
}
