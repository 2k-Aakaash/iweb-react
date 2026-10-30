// Control Center's glyphs, drawn here in the spirit of SF Symbols (original artwork).
// All take `size` (px) and draw in currentColor.

function Svg({ size = 20, children, fill = 'none', viewBox = '0 0 24 24', ...rest }) {
  return (
    <svg
      viewBox={viewBox}
      width={size}
      height={size}
      fill={fill}
      stroke={fill === 'none' ? 'currentColor' : 'none'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function ControlCenterIcon({ size = 16 }) {
  return (
    <Svg size={size} viewBox="0 0 20 16" strokeWidth="1.6">
      <rect x="1.5" y="1.5" width="17" height="5.2" rx="2.6" />
      <circle cx="6" cy="4.1" r="1.5" fill="currentColor" stroke="none" />
      <rect x="1.5" y="9.3" width="17" height="5.2" rx="2.6" />
      <circle cx="14" cy="11.9" r="1.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function WifiIcon({ size, off = false }) {
  return (
    <Svg size={size} viewBox="0 0 20 16" fill="currentColor">
      <g opacity={off ? 0.45 : 1}>
        <path d="M10 13.6a1.6 1.6 0 1 1 0 .01z" />
        <path d="M5.9 10.3a5.8 5.8 0 0 1 8.2 0l-1.3 1.3a4 4 0 0 0-5.6 0z" />
        <path d="M3.1 7.5a9.8 9.8 0 0 1 13.8 0l-1.3 1.3a8 8 0 0 0-11.2 0z" />
        <path d="M.3 4.7a13.8 13.8 0 0 1 19.4 0l-1.3 1.3a12 12 0 0 0-16.8 0z" />
      </g>
      {off && <path d="M3 1l14 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
    </Svg>
  );
}

export function PlayIcon({ size }) {
  return <Svg size={size} fill="currentColor"><path d="M7 4.6v14.8a1 1 0 0 0 1.5.86l12.3-7.4a1 1 0 0 0 0-1.72L8.5 3.74A1 1 0 0 0 7 4.6z" /></Svg>;
}

export function PauseIcon({ size }) {
  return (
    <Svg size={size} fill="currentColor">
      <rect x="6" y="4" width="4.2" height="16" rx="1.2" />
      <rect x="13.8" y="4" width="4.2" height="16" rx="1.2" />
    </Svg>
  );
}

export function BackwardIcon({ size }) {
  return (
    <Svg size={size} fill="currentColor">
      <path d="M11.5 6.2v11.6a.8.8 0 0 1-1.25.66L2.3 12.66a.8.8 0 0 1 0-1.32l7.95-5.8a.8.8 0 0 1 1.25.66z" />
      <path d="M21.5 6.2v11.6a.8.8 0 0 1-1.25.66l-7.95-5.8a.8.8 0 0 1 0-1.32l7.95-5.8a.8.8 0 0 1 1.25.66z" />
    </Svg>
  );
}

export function ForwardIcon({ size }) {
  return (
    <Svg size={size} fill="currentColor">
      <path d="M12.5 6.2v11.6a.8.8 0 0 0 1.25.66l7.95-5.8a.8.8 0 0 0 0-1.32l-7.95-5.8a.8.8 0 0 0-1.25.66z" />
      <path d="M2.5 6.2v11.6a.8.8 0 0 0 1.25.66l7.95-5.8a.8.8 0 0 0 0-1.32l-7.95-5.8a.8.8 0 0 0-1.25.66z" />
    </Svg>
  );
}

export function MusicNoteIcon({ size }) {
  return (
    <Svg size={size}>
      <path d="M9 18V5.5l11-2V16" />
      <circle cx="6.5" cy="18" r="2.6" fill="currentColor" />
      <circle cx="17.5" cy="16" r="2.6" fill="currentColor" />
    </Svg>
  );
}

export function WidgetsIcon({ size }) {
  return (
    <Svg size={size} strokeWidth="1.9">
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="2" />
      <rect x="3.5" y="13" width="17" height="7.5" rx="2" />
    </Svg>
  );
}

export function GlassClockIcon({ size }) {
  return (
    <Svg size={size} strokeWidth="1.9">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
      <path d="M6.8 8.2a6 6 0 0 1 3-2.6" opacity="0.6" />
    </Svg>
  );
}

export function MoonIcon({ size }) {
  return <Svg size={size} fill="currentColor"><path d="M20.4 14.6A8.6 8.6 0 0 1 9.4 3.6a.6.6 0 0 0-.8-.7A9.4 9.4 0 1 0 21.1 15.4a.6.6 0 0 0-.7-.8z" /></Svg>;
}

export function ShowDesktopIcon({ size }) {
  return (
    <Svg size={size} strokeWidth="1.9">
      <rect x="2.5" y="4" width="19" height="13" rx="2.2" />
      <path d="M8 21h8M12 17v4" />
      <path d="M6.5 13.5h4" opacity="0.7" />
    </Svg>
  );
}

export function EditWidgetsIcon({ size }) {
  return (
    <Svg size={size} strokeWidth="1.9">
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <path d="m14.6 20.6 1-3.2 4.3-4.3a1.6 1.6 0 0 1 2.2 2.2l-4.3 4.3z" />
    </Svg>
  );
}

export function SunIcon({ size, large = false }) {
  const rays = large ? 3.2 : 2.2;
  return (
    <Svg size={size} strokeWidth="1.8">
      <circle cx="12" cy="12" r={large ? 4.2 : 3.4} fill="currentColor" stroke="none" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
        <path key={deg} d={`M12 ${3.2} v${rays}`} transform={`rotate(${deg} 12 12)`} />
      ))}
    </Svg>
  );
}

export function SpeakerIcon({ size, level = 0 }) {
  return (
    <Svg size={size} strokeWidth="1.9">
      <path d="M4 9.2h3.4L12 5v14l-4.6-4.2H4z" fill="currentColor" />
      {level >= 1 && <path d="M15.4 9.3a4 4 0 0 1 0 5.4" />}
      {level >= 2 && <path d="M17.9 6.8a7.6 7.6 0 0 1 0 10.4" />}
      {level >= 3 && <path d="M20.3 4.6a11 11 0 0 1 0 14.8" />}
    </Svg>
  );
}

export function SpeakerMutedIcon({ size }) {
  return (
    <Svg size={size} strokeWidth="1.9">
      <path d="M4 9.2h3.4L12 5v14l-4.6-4.2H4z" fill="currentColor" />
      <path d="m16 9.5 5 5m0-5-5 5" />
    </Svg>
  );
}

export function AudioOutputIcon({ size }) {
  return (
    <Svg size={size} strokeWidth="1.9">
      <path d="M6.3 16.5a8 8 0 1 1 11.4 0" />
      <path d="M8.9 13.9a4.3 4.3 0 1 1 6.2 0" />
      <path d="M12 15.5 7.5 21h9z" fill="currentColor" />
    </Svg>
  );
}

export function NightShiftIcon({ size }) {
  return (
    <Svg size={size} strokeWidth="1.9">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
    </Svg>
  );
}

export function CalculatorIcon({ size }) {
  return (
    <Svg size={size} strokeWidth="1.9">
      <rect x="5" y="2.5" width="14" height="19" rx="2.6" />
      <rect x="8" y="5.5" width="8" height="3.2" rx="0.8" fill="currentColor" stroke="none" />
      {[11.8, 15, 18.2].flatMap((y) => [8.6, 12, 15.4].map((x) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.05" fill="currentColor" stroke="none" />
      )))}
    </Svg>
  );
}

export function TimerIcon({ size }) {
  return (
    <Svg size={size} strokeWidth="1.9">
      <path d="M12 3.5a8.5 8.5 0 1 1-6 2.5" />
      <path d="M12 3.5V7" />
      <path d="m8.4 8.4 4.1 4.1" />
    </Svg>
  );
}

export function ScreenshotIcon({ size }) {
  return (
    <Svg size={size} strokeWidth="1.9">
      <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" />
      <path d="M8 9.6h1.6l1-1.4h2.8l1 1.4H16a1 1 0 0 1 1 1v4.2a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-4.2a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="12.6" r="1.6" />
    </Svg>
  );
}

export function FullscreenIcon({ size, exit = false }) {
  return (
    <Svg size={size} strokeWidth="1.9">
      {exit
        ? <path d="M9 3.5V9H3.5M15 3.5V9h5.5M9 20.5V15H3.5M15 20.5V15h5.5" />
        : <path d="M3.5 9V3.5H9M20.5 9V3.5H15M3.5 15v5.5H9M20.5 15v5.5H15" />}
    </Svg>
  );
}

export function ChevronLeftIcon({ size = 14 }) {
  return <Svg size={size} strokeWidth="2.4"><path d="m15 5-7 7 7 7" /></Svg>;
}

export function ChevronRightIcon({ size = 14 }) {
  return <Svg size={size} strokeWidth="2.4"><path d="m9 5 7 7-7 7" /></Svg>;
}

export function MinusIcon({ size = 10 }) {
  return <Svg size={size} strokeWidth="3"><path d="M5 12h14" /></Svg>;
}

export function PlusIcon({ size = 10 }) {
  return <Svg size={size} strokeWidth="3"><path d="M12 5v14M5 12h14" /></Svg>;
}

export function CheckIcon({ size = 14 }) {
  return <Svg size={size} strokeWidth="2.6"><path d="m5 12.5 4.2 4.2L19 7" /></Svg>;
}
