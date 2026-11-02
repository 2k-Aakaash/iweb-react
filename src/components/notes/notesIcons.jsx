// Line icons for Notes (SF Symbols-like, 24 × 24 grid, drawn in currentColor).

const Icon = ({ size = 16, stroke = 1.8, children, ...rest }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
    {children}
  </svg>
);

export const ComposeIcon = (p) => (
  <Icon {...p}><path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /><path d="M17.6 3.4a2 2 0 0 1 2.9 2.9L12 14.8l-3.6.8.8-3.6z" /></Icon>
);
export const NewTaskIcon = (p) => (
  <Icon {...p}><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="m8 12 3 3 5-6" /></Icon>
);
export const NotesIcon = (p) => (
  <Icon {...p}><path d="M5 4h10l4 4v12H5z" /><path d="M15 4v4h4M8.5 12.5h7M8.5 16h5" /></Icon>
);
export const PinIcon = ({ filled, ...p }) => (
  <Icon {...p}><path d="M9 3.5h6l-1 5 3.5 3.5v1.5h-11V12L10 8.5z" fill={filled ? 'currentColor' : 'none'} /><path d="M12 13.5V21" /></Icon>
);
export const TodayIcon = (p) => (
  <Icon {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></Icon>
);
export const OverdueIcon = (p) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></Icon>
);
export const CalendarIcon = (p) => (
  <Icon {...p}><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></Icon>
);
export const ChecklistIcon = (p) => (
  <Icon {...p}><path d="m3.5 6.5 1.6 1.6 3-3M3.5 13.5l1.6 1.6 3-3" /><path d="M11.5 7h9M11.5 14h9M11.5 20h9M4.5 20h2" /></Icon>
);
export const CompletedIcon = (p) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="m8 12.2 2.8 2.8L16.2 9" /></Icon>
);
export const TagIcon = (p) => (
  <Icon {...p}><path d="M9 3.5 7 20.5M17 3.5l-2 17M4 9h16.5M3.5 15H20" /></Icon>
);
export const SidebarIcon = (p) => (
  <Icon {...p}><rect x="3" y="4.5" width="18" height="15" rx="3" /><path d="M9.5 4.5v15" /></Icon>
);
export const SortIcon = (p) => (
  <Icon {...p}><path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5" /></Icon>
);
export const MoreIcon = (p) => (
  <Icon {...p} stroke={0}><circle cx="6" cy="12" r="1.7" fill="currentColor" /><circle cx="12" cy="12" r="1.7" fill="currentColor" /><circle cx="18" cy="12" r="1.7" fill="currentColor" /></Icon>
);
export const TrashIcon = (p) => (
  <Icon {...p}><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></Icon>
);
// A note card on a screen: Show on Desktop.
export const DesktopIcon = ({ filled, ...p }) => (
  <Icon {...p}><rect x="2.5" y="4" width="19" height="13" rx="2.5" /><path d="M9 21h6M12 17v4" /><rect x="11" y="7" width="7" height="6" rx="1.2" fill={filled ? 'currentColor' : 'none'} /></Icon>
);
export const SearchIcon = (p) => (
  <Icon {...p} stroke={2.2}><circle cx="11" cy="11" r="7" /><path d="M20.5 20.5 16 16" /></Icon>
);
export const GripIcon = (p) => (
  <Icon {...p} stroke={0}>{[7, 12, 17].flatMap((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" fill="currentColor" />))}</Icon>
);
export const PlusIcon = (p) => (
  <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>
);
export const CloseIcon = (p) => (
  <Icon {...p} stroke={2.2}><path d="M6 6l12 12M18 6 6 18" /></Icon>
);
export const ChevronIcon = ({ up, ...p }) => (
  <Icon {...p} stroke={2.2}><path d={up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} /></Icon>
);
export const OpenIcon = (p) => (
  <Icon {...p}><path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></Icon>
);
