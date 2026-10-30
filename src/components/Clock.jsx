import { useState, useEffect, useRef } from 'react';
import { useClockStyle } from '../libs/clock/clockStyle';
import { useGlassFill } from '../libs/clock/clockGlass';

// The desktop clock. The quote under it is its own item (Quote.jsx). In the Glass style
// (the default, as on the iOS 26 Lock Screen) its digits are frosted glass over the
// wallpaper: libs/clock/clockGlass.js fills them, desktop.css and the filter below light them.
export default function Clock({ clockFont }) {
  const [time, setTime] = useState(formatTime(new Date()));
  const glass = useClockStyle() === 'glass';
  const timeRef = useRef(null);
  useGlassFill(timeRef, glass);

  function formatTime(date) {
    let hours = date.getHours();
    let minutes = date.getMinutes();
    let period = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    minutes = minutes < 10 ? `0${minutes}` : minutes;
    return `${hours}:${minutes} ${period}`;
  }

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(formatTime(new Date()));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="center">
      <span
        ref={timeRef}
        id="clock"
        className={`clock-time${glass ? ' is-glass' : ''}`}
        style={{ fontFamily: clockFont || 'inherit' }}
      >
        {time}
      </span>
      {glass && <ClockGlassFilter />}
    </div>
  );
}

// The glass's edges, drawn from the shape of the digits and kept subtle, as on iOS: a faint
// shadow beneath, a soft band of light just inside every edge, a gentle highlight from the
// top left and a thin rim. The fill itself (the wallpaper) gets a touch brighter and more
// colourful, as glass over a photo does.
function ClockGlassFilter() {
  return (
    <svg className="clock-glass-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <filter id="iweb-clock-glass" x="-10%" y="-20%" width="120%" height="150%" colorInterpolationFilters="sRGB">
        <feColorMatrix in="SourceGraphic" type="saturate" values="1.3" result="vivid" />
        <feComponentTransfer in="vivid" result="glass">
          <feFuncR type="linear" slope="1.06" intercept="0.04" />
          <feFuncG type="linear" slope="1.06" intercept="0.04" />
          <feFuncB type="linear" slope="1.06" intercept="0.04" />
        </feComponentTransfer>
        {/* Shadow */}
        <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="shadowBlur" />
        <feOffset in="shadowBlur" dy="1" result="shadowOffset" />
        <feFlood floodColor="#000" floodOpacity="0.08" />
        <feComposite in2="shadowOffset" operator="in" result="shadow" />
        {/* Inner glow: light gathering inside the edges */}
        <feMorphology in="SourceAlpha" operator="erode" radius="1.5" result="core" />
        <feGaussianBlur in="core" stdDeviation="1.4" result="coreSoft" />
        <feComposite in="SourceAlpha" in2="coreSoft" operator="out" result="band" />
        <feFlood floodColor="#fff" floodOpacity="0.16" />
        <feComposite in2="band" operator="in" result="glow" />
        {/* Highlight: a gentle light from the top left */}
        <feGaussianBlur in="SourceAlpha" stdDeviation="2" result="bump" />
        <feSpecularLighting in="bump" surfaceScale="2" specularConstant="0.35" specularExponent="30" lightingColor="#fff" result="light">
          <feDistantLight azimuth="235" elevation="40" />
        </feSpecularLighting>
        <feComposite in="light" in2="SourceAlpha" operator="in" result="shine" />
        {/* Rim */}
        <feMorphology in="SourceAlpha" operator="erode" radius="0.8" result="inner" />
        <feComposite in="SourceAlpha" in2="inner" operator="out" result="edge" />
        <feFlood floodColor="#fff" floodOpacity="0.32" />
        <feComposite in2="edge" operator="in" result="rim" />
        <feMerge>
          <feMergeNode in="shadow" />
          <feMergeNode in="glass" />
          <feMergeNode in="glow" />
          <feMergeNode in="shine" />
          <feMergeNode in="rim" />
        </feMerge>
      </filter>
    </svg>
  );
}
