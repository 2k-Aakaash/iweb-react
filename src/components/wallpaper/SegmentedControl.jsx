import { useRef } from 'react';

// macOS-style segmented control with radiogroup semantics and roving tabindex.
export default function SegmentedControl({ options, value, onChange, label, size = 'md', disabled = false }) {
  const buttonRefs = useRef([]);

  const select = (index) => {
    const option = options[index];
    if (!option || disabled) return;
    buttonRefs.current[index]?.focus();
    if (option.value !== value) onChange(option.value);
  };

  const handleKeyDown = (e, index) => {
    const last = options.length - 1;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    select(next);
  };

  const hasSelection = options.some((o) => o.value === value);

  return (
    <div
      className={`wp-segmented wp-segmented-${size}`}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        const focusable = checked || (!hasSelection && index === 0);
        return (
          <button
            key={option.value}
            ref={(el) => { buttonRefs.current[index] = el; }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={focusable ? 0 : -1}
            disabled={disabled}
            className={`wp-segment ${checked ? 'is-checked' : ''}`}
            onClick={() => select(index)}
            onKeyDown={(e) => handleKeyDown(e, index)}
          >
            {option.label}
            {typeof option.count === 'number' && <span className="wp-segment-count">{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
