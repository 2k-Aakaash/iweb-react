// A macOS 26 slider (styles/mac-controls.css): a range input whose track fills with the
// accent colour up to its value. `onChange` gets the number.
export default function MacSlider({ value, min = 0, max = 100, step = 1, onChange, className = '', style, ...rest }) {
  const span = Number(max) - Number(min);
  const raw = span > 0 ? ((Number(value) - Number(min)) / span) * 100 : 0;
  const fill = Number.isFinite(raw) ? raw : 0; // a missing value draws an empty track, not none
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange?.(Number(e.target.value))}
      className={`mac-slider${className ? ` ${className}` : ''}`}
      style={{ ...style, '--fill': `${Math.min(100, Math.max(0, fill))}%` }}
      {...rest}
    />
  );
}
