// A small line icon for each Frontier weather (and the night's moon), drawn in currentColor
// so it follows the text it sits with. Decorative: the weather's name is always written next
// to it, so nothing relies on the picture alone.

const sun = <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" /></>;
const moon = <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" />;
const cloud = (y = 0) => <path d={`M7 ${18 + y}h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.2 ${11.2 + y} 3.5 3.5 0 0 0 7 ${18 + y}z`} />;
const drops = (n) => Array.from({ length: n }, (_, i) => <path key={i} d={`M${8 + i * 4} 19.5l-1 2.5`} />);

const SHAPES = {
  clear: (night) => (night ? moon : sun),
  'partly-cloudy': (night) => <><g transform="translate(-3 -3) scale(0.75)">{night ? moon : sun}</g>{cloud(1)}</>,
  overcast: () => cloud(),
  'light-rain': () => <>{cloud(-3)}{drops(2)}</>,
  'heavy-rain': () => <>{cloud(-3)}{drops(3)}</>,
  thunderstorm: () => <>{cloud(-3)}<path d="M12.5 16l-2 3.5h3l-2 3.5" /></>,
  fog: () => <path d="M4 9h16M6 13h12M4 17h16" />,
  snowfall: () => <>{cloud(-3)}<path d="M8 19.5h.01M12 21h.01M16 19.5h.01" /></>,
  windy: () => <path d="M3 9h11a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3M3 19h7" />,
  'dust-wind': () => <><path d="M3 9h11a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3" /><path d="M5 19h.01M9 20h.01M13 19h.01" /></>,
};

export default function WeatherIcon({ weather, night = false, size = 14, className = '' }) {
  const shape = (SHAPES[weather] || SHAPES.clear)(night);
  return (
    <svg className={`fr-weather-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {shape}
    </svg>
  );
}
