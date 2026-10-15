import { memo, useId, useState } from 'react';
import Sparkline from '../widgets/shared/Sparkline';
import { formatChange, formatPrice, isMetal } from '../../libs/markets/marketService';
import { dropIndex } from './listOrder';
import { formatSignedPercent, metalUnit, priceCurrency, speakChange } from './format';

// Watchlist for the Markets app sidebar (macOS Stocks style): name + symbol, intraday
// sparkline, price and a green/red change pill that toggles % ↔ value for every row.
// Rows are memoised; clicks, keys and drags are handled once on the list (delegation).
//
// Keyboard on a row: ArrowUp/Down select, Home/End, Enter/Space open, Delete/Backspace
// remove, Alt+ArrowUp/Down reorder. Drag and drop reorders with the mouse.

const WatchRow = memo(function WatchRow({ item, quote, loaded, isSelected, isFocusable, changeMode, dragState, hintId }) {
  const { symbol, name } = item;
  const direction = quote?.direction || 'flat';
  const price = quote?.price;
  const hasPrice = Number.isFinite(price);
  const priceText = hasPrice ? formatPrice(price, { currency: priceCurrency(symbol, quote.currency) }) : '—';
  const values = quote?.points?.length > 1 ? quote.points.map((point) => point[1]) : null;
  const baseline = Number.isFinite(quote?.previousClose) ? quote.previousClose : null;
  const subtitle = isMetal(symbol) ? metalUnit(symbol) : symbol;
  const hasChange = Number.isFinite(quote?.changePercent);
  const pillText = changeMode === 'absolute' ? formatChange(quote?.change) : formatSignedPercent(quote?.changePercent);

  let label = `${name}, ${subtitle}`;
  if (hasPrice) label += `, ${priceText}, ${speakChange(quote.changePercent)}`;
  else label += loaded ? ', no data' : ', loading';

  const tabIndex = isFocusable ? 0 : -1;
  const rowClass = [
    'mk-row',
    isSelected ? 'is-selected' : '',
    dragState ? `is-${dragState}` : '',
  ].filter(Boolean).join(' ');

  return (
    <li className={rowClass} data-symbol={symbol} draggable>
      <div
        className="mk-row-main"
        role="button"
        tabIndex={tabIndex}
        aria-current={isSelected ? 'true' : undefined}
        aria-label={label}
        aria-describedby={hintId}
        data-action="open"
      >
        <span className="mk-row-names">
          <span className="mk-row-name">{name}</span>
          <span className="mk-row-sub">{subtitle}</span>
        </span>
        <span className={`mk-row-spark mk-dir-${direction}`}>
          {values && <Sparkline values={values} baseline={baseline} width={60} height={28} className="mk-spark" />}
        </span>
        <span className="mk-row-quote">
          {hasPrice || loaded
            ? <span className="mk-row-price">{priceText}</span>
            : <span className="mk-skeleton mk-skeleton-price" aria-hidden="true" />}
        </span>
      </div>

      {hasChange ? (
        <button
          type="button"
          className={`mk-pill mk-pill-${direction}`}
          tabIndex={tabIndex}
          aria-label={`${pillText}. Show change in ${changeMode === 'absolute' ? 'percent' : 'value'}`}
          title={`Show change in ${changeMode === 'absolute' ? 'percent' : 'value'}`}
          data-action="toggle-change"
        >
          {pillText}
        </button>
      ) : (
        <span className={`mk-pill mk-pill-flat${loaded ? '' : ' mk-skeleton'}`} aria-hidden="true">
          {loaded ? '—' : ''}
        </span>
      )}

      <button
        type="button"
        className="mk-row-remove"
        tabIndex={tabIndex}
        aria-label={`Remove ${name} from watchlist`}
        title="Remove from watchlist"
        data-action="remove"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d="m3.5 3.5 5 5m0-5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </li>
  );
});

function rowMain(list, symbol) {
  if (!list || !symbol) return null;
  const row = [...list.querySelectorAll('[data-symbol]')].find((element) => element.dataset.symbol === symbol);
  return row?.querySelector('.mk-row-main') || null;
}

export default function Watchlist({
  items,
  quotes,
  loaded,
  error,
  onRetry,
  selected,
  changeMode,
  listRef,
  onSelect,
  onOpen,
  onRemove,
  onMove,
  onToggleChangeMode,
  onRestoreDefaults,
}) {
  const headingId = useId();
  const hintId = useId();
  // { symbol, over, position } while a row is being dragged.
  const [drag, setDrag] = useState(null);

  const focusSymbol = items.some((item) => item.symbol === selected) ? selected : items[0]?.symbol;
  const hasQuotes = Object.keys(quotes).length > 0;

  const symbolOf = (target) => target.closest?.('[data-symbol]')?.dataset.symbol || null;

  const handleClick = (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    const symbol = symbolOf(e.target);
    if (!action || !symbol) return;
    if (action === 'open') onOpen(symbol);
    else if (action === 'toggle-change') onToggleChangeMode();
    else if (action === 'remove') onRemove(symbol);
  };

  const handleKeyDown = (e) => {
    if (!e.target.classList?.contains('mk-row-main')) return;
    const symbol = symbolOf(e.target);
    const index = items.findIndex((item) => item.symbol === symbol);
    if (index === -1) return;

    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      onMove(symbol, index + (e.key === 'ArrowUp' ? -1 : 1));
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;

    const go = (to) => {
      const target = items[Math.max(0, Math.min(items.length - 1, to))];
      if (!target) return;
      onSelect(target.symbol);
      rowMain(listRef.current, target.symbol)?.focus();
    };
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        go(index + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        go(index - 1);
        break;
      case 'Home':
        e.preventDefault();
        go(0);
        break;
      case 'End':
        e.preventDefault();
        go(items.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onOpen(symbol);
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        onRemove(symbol);
        break;
      default:
        break;
    }
  };

  const handleDragStart = (e) => {
    const symbol = symbolOf(e.target);
    if (!symbol) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', symbol);
    setDrag({ symbol, over: null, position: null });
  };

  const handleDragOver = (e) => {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const row = e.target.closest?.('[data-symbol]');
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    const over = row.dataset.symbol;
    if (drag.over !== over || drag.position !== position) setDrag({ ...drag, over, position });
  };

  const handleDragLeave = (e) => {
    if (drag && !e.currentTarget.contains(e.relatedTarget)) setDrag({ ...drag, over: null, position: null });
  };

  const handleDrop = (e) => {
    if (!drag) return;
    e.preventDefault();
    const from = items.findIndex((item) => item.symbol === drag.symbol);
    const over = items.findIndex((item) => item.symbol === drag.over);
    if (from !== -1 && over !== -1) onMove(drag.symbol, dropIndex(from, over, drag.position));
    setDrag(null);
  };

  const handleDragEnd = () => setDrag(null);

  const dragStateFor = (symbol) => {
    if (!drag) return null;
    if (drag.symbol === symbol) return 'dragging';
    if (drag.over === symbol) return drag.position === 'before' ? 'drop-before' : 'drop-after';
    return null;
  };

  return (
    <div className="mk-watchlist">
      <h3 id={headingId} className="mk-section-title">Watchlist</h3>

      {error && !hasQuotes && items.length > 0 && (
        <div className="mk-banner" role="alert">
          <span>{error}</span>
          <button type="button" className="mk-btn mk-btn-small" onClick={onRetry}>Retry</button>
        </div>
      )}

      {items.length ? (
        <ul
          ref={listRef}
          className="mk-list"
          aria-labelledby={headingId}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
        >
          {items.map((item) => (
            <WatchRow
              key={item.symbol}
              item={item}
              quote={quotes[item.symbol] || null}
              loaded={loaded}
              isSelected={item.symbol === selected}
              isFocusable={item.symbol === focusSymbol}
              changeMode={changeMode}
              dragState={dragStateFor(item.symbol)}
              hintId={hintId}
            />
          ))}
        </ul>
      ) : (
        <div className="mk-empty">
          <p className="mk-empty-title">Your watchlist is empty</p>
          <p>Search NSE / BSE above to add stocks, indices or gold and silver.</p>
          <button type="button" className="mk-btn" onClick={onRestoreDefaults}>Restore default list</button>
        </div>
      )}

      <p id={hintId} className="mk-sr-only">
        Press Delete to remove. Press Alt with the up or down arrow to reorder.
      </p>
    </div>
  );
}
