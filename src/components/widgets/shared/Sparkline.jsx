import { useId } from 'react';

// Small line + soft area chart for widget cards. Strokes with currentColor, so the
// colour comes from the container (e.g. white on a mood-coloured card).
// `values` is an array of numbers (oldest first); `baseline` optionally draws a dashed
// reference line (e.g. previous close) inside the value range.
export default function Sparkline({ values, width, height, className, baseline = null }) {
  const gradientId = `ws-spark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  if (!Array.isArray(values) || values.length < 2) return null;

  const all = baseline === null ? values : [...values, baseline];
  const min = Math.min(...all);
  const span = Math.max(...all) - min;
  const inset = 2;
  const step = width / (values.length - 1);
  const yFor = (value) => (span === 0 ? height / 2 : inset + (1 - (value - min) / span) * (height - inset * 2));
  const coords = values.map((value, index) => `${(index * step).toFixed(2)},${yFor(value).toFixed(2)}`);
  const line = `M${coords.join(' L')}`;
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      {baseline !== null && (
        <line
          x1="0"
          x2={width}
          y1={yFor(baseline)}
          y2={yFor(baseline)}
          stroke="currentColor"
          strokeOpacity="0.45"
          strokeWidth="1"
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
