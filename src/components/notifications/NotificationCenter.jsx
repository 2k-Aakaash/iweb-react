import { useEffect, useRef, useState } from 'react';
import GlassSurface from '../glass/GlassSurface';
import {
  APPS,
  clearAll,
  clearApp,
  dismissBanner,
  groupByApp,
  holdBanner,
  notify,
  openNotification,
  removeNotification,
  setQuiet,
  timeAgo,
  useNotifications,
} from '../../libs/notifications/notifications';
import { focusPref } from '../../libs/controlcenter/ccPrefs';
import { ensureLoaded, getNotesState, useNotes } from '../../libs/notes/notesStore';
import { tasksForView } from '../../libs/notes/views';
import { dayKey } from '../../libs/notes/tasks';
import { formatRemaining, isRunning, remainingAt, useTicker, useTimer } from '../../libs/controlcenter/timer';
import { openNotes } from '../../libs/notes/notesEvents';
import '../../styles/notification-center.css';

// Notification Center, as in macOS 26: the menu bar clock opens it at the right of the screen,
// notifications (grouped by app) above widgets — the calendar, today's tasks from Notes and a
// running timer. New notifications also show as a banner for a few seconds
// (libs/notifications/notifications.js). Toggled with the `notifications:toggle` event; it
// reports `notifications:state` so the menu bar stays shown while it's open.

export const NC_TOGGLE = 'notifications:toggle';
export const NC_CLOSE = 'notifications:close';
export const NC_STATE = 'notifications:state';
const OUT_MS = 220;

function AppIcon({ app }) {
  const kind = APPS[app]?.icon || 'iweb';
  const glyph = {
    timer: <><circle cx="12" cy="13" r="7" /><path d="M12 9v4l2.5 1.5M10 3h4" /></>,
    update: <><path d="M12 4v10m-4-4 4 4 4-4" /><path d="M5 18h14" /></>,
    notes: <><rect x="6" y="4" width="12" height="16" rx="2" /><path d="M9 9h6M9 12h6M9 15h4" /></>,
    music: <><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></>,
    dock: <><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 11h2M11 11h2M15 11h2" /></>,
    backup: <><path d="M12 4a8 8 0 1 1-7.4 5" /><path d="M4 4v5h5" /></>,
    iweb: <><circle cx="12" cy="12" r="8" /><path d="M8 12h8M12 8v8" /></>,
  }[kind];
  return (
    <span className={`nc-app-icon is-${kind}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{glyph}</svg>
    </span>
  );
}

function NotificationCard({ n, now, onOpen, onClose, banner = false }) {
  return (
    <div className={`nc-card glass-host${banner ? ' is-banner' : ''}`}>
      <GlassSurface preset="tile" />
      <button type="button" className="nc-card-main" onClick={() => onOpen(n)}>
        <AppIcon app={n.app} />
        <span className="nc-card-text">
          <span className="nc-card-head">
            <span className="nc-card-title">{n.title}</span>
            <span className="nc-card-time">{timeAgo(n.time, now)}</span>
          </span>
          {n.body && <span className="nc-card-body">{n.body}</span>}
        </span>
      </button>
      <button type="button" className="nc-card-close" aria-label={`Clear ${n.title}`} onClick={() => onClose(n)}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 3.5l5 5M8.5 3.5l-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}

function CalendarWidget({ now }) {
  const d = new Date(now);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const lead = first.getDay();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const weekdays = [...Array(7)].map((_, i) => new Date(2024, 0, 7 + i).toLocaleDateString(undefined, { weekday: 'narrow' }));
  return (
    <section className="nc-widget nc-calendar glass-host" aria-label="Calendar">
      <GlassSurface preset="tile" />
      <div className="nc-cal-today">
        <span className="nc-cal-weekday">{d.toLocaleDateString(undefined, { weekday: 'long' })}</span>
        <span className="nc-cal-day">{d.getDate()}</span>
        <span className="nc-cal-month">{d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
      </div>
      <div className="nc-cal-grid" role="grid" aria-label={d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}>
        {weekdays.map((w, i) => <span key={`w${i}`} className="nc-cal-wd">{w}</span>)}
        {cells.map((day, i) => (
          <span key={i} className={`nc-cal-cell${day === d.getDate() ? ' is-today' : ''}`}>{day || ''}</span>
        ))}
      </div>
    </section>
  );
}

function TasksWidget({ onDone }) {
  const { notes, status } = useNotes();
  const loaded = status === 'ready';
  useEffect(() => {
    ensureLoaded();
  }, []);
  const today = dayKey();
  const tasks = [];
  for (const note of notes) {
    for (const task of tasksForView(note, 'today', today)) tasks.push({ note, task });
    for (const task of tasksForView(note, 'overdue', today)) tasks.push({ note, task, overdue: true });
  }
  const shown = tasks.slice(0, 5);
  return (
    <section className="nc-widget nc-tasks glass-host" aria-label="Today's tasks">
      <GlassSurface preset="tile" />
      <button type="button" className="nc-widget-head" onClick={() => { onDone(); openNotes({ view: 'today' }); }}>
        <span>Today</span>
        <span className="nc-widget-count">{loaded ? tasks.length : ''}</span>
      </button>
      {loaded && shown.length === 0 && <p className="nc-empty-line">Nothing due today.</p>}
      <ul className="nc-task-list">
        {shown.map(({ note, task, overdue }) => (
          <li key={`${note.id}-${task.index}`} className={`nc-task${overdue ? ' is-overdue' : ''}`}>
            <span className="nc-task-dot" aria-hidden="true" />
            <span className="nc-task-text">{task.text}</span>
            {overdue && <span className="nc-task-flag">Overdue</span>}
          </li>
        ))}
      </ul>
      {tasks.length > shown.length && <p className="nc-empty-line">{tasks.length - shown.length} more in Notes</p>}
    </section>
  );
}

function TimerWidget({ now }) {
  const timer = useTimer();
  if (!isRunning(timer) && !timer.done) return null;
  return (
    <section className="nc-widget nc-timer glass-host" aria-label="Timer">
      <GlassSurface preset="tile" />
      <span className="nc-widget-head is-static">Timer</span>
      <span className="nc-timer-left">{timer.done ? 'Done' : formatRemaining(remainingAt(timer, now))}</span>
    </section>
  );
}

function Panel({ closing, onClose }) {
  const { list } = useNotifications();
  const now = useTicker(true, 1000);
  const [expanded, setExpanded] = useState({});
  const groups = groupByApp(list);
  const open = (n) => {
    onClose();
    openNotification(n);
  };
  return (
    <>
      <div className={`nc-backdrop${closing ? ' is-closing' : ''}`} aria-hidden="true" />
      <aside className={`nc${closing ? ' is-closing' : ''}`} aria-label="Notification Center" role="dialog" tabIndex={-1}>
        <div className="nc-section-head">
          <h2>Notifications</h2>
          {list.length > 0 && <button type="button" className="nc-text-btn" onClick={clearAll}>Clear All</button>}
        </div>
        {groups.length === 0 && <p className="nc-none">No Notifications</p>}
        {groups.map(({ app, items }) => {
          const many = items.length > 1;
          const isOpen = expanded[app] || !many;
          return (
            <div key={app} className={`nc-group${many && !isOpen ? ' is-stacked' : ''}`}>
              {many && (
                <div className="nc-group-head">
                  <span>{APPS[app]?.name || app}</span>
                  <span className="nc-group-actions">
                    <button type="button" className="nc-text-btn" onClick={() => setExpanded((e) => ({ ...e, [app]: !isOpen }))}>
                      {isOpen ? 'Show Less' : `${items.length} notifications`}
                    </button>
                    <button type="button" className="nc-text-btn" onClick={() => clearApp(app)}>Clear</button>
                  </span>
                </div>
              )}
              {(isOpen ? items : items.slice(0, 1)).map((n) => (
                <NotificationCard key={n.id} n={n} now={now} onOpen={open} onClose={(x) => removeNotification(x.id)} />
              ))}
            </div>
          );
        })}
        <div className="nc-widgets">
          <CalendarWidget now={now} />
          <TasksWidget onDone={onClose} />
          <TimerWidget now={now} />
        </div>
      </aside>
    </>
  );
}

function Banner() {
  const { banner } = useNotifications();
  const now = useTicker(Boolean(banner), 30000);
  const [ncOpen, setNcOpen] = useState(false);
  useEffect(() => {
    const onState = (e) => setNcOpen(Boolean(e.detail?.open));
    window.addEventListener(NC_STATE, onState);
    return () => window.removeEventListener(NC_STATE, onState);
  }, []);
  if (!banner || ncOpen) return null;
  return (
    <div className="nc-banner" role="status" aria-live="polite" onPointerEnter={() => holdBanner(true)} onPointerLeave={() => holdBanner(false)}>
      <NotificationCard
        key={banner.id}
        n={banner}
        now={now}
        banner
        onOpen={(n) => openNotification(n)}
        onClose={() => dismissBanner()}
      />
    </div>
  );
}

// Tasks due today or overdue: one notification a day (checked on each new tab until there's
// something to say), once Notes has loaded in the background.
function useTasksDueNotice() {
  useEffect(() => {
    const day = dayKey();
    let seen;
    try {
      seen = localStorage.getItem('iweb:tasksNoticeDay');
    } catch {
      return undefined;
    }
    if (seen === day) return undefined;
    const timer = setTimeout(() => {
      const check = () => {
        const { notes, status } = getNotesState();
        if (status !== 'ready') return false;
        let due = 0;
        let overdue = 0;
        for (const note of notes) {
          due += tasksForView(note, 'today', day).filter((t) => !t.checked).length;
          overdue += tasksForView(note, 'overdue', day).filter((t) => !t.checked).length;
        }
        // The day is marked once a notice is posted, so tasks added later still get one.
        if (due + overdue > 0) {
          try {
            localStorage.setItem('iweb:tasksNoticeDay', day);
          } catch {
            // Storage blocked: it may show again in another tab.
          }
          const parts = [];
          if (due) parts.push(`${due} ${due === 1 ? 'task' : 'tasks'} due today`);
          if (overdue) parts.push(`${overdue} overdue`);
          notify({ app: 'notes', title: 'Tasks', body: `${parts.join(', ')}.`, key: `tasks:${day}`, action: { event: 'notes:open', detail: { view: due ? 'today' : 'overdue' } } });
        }
        return true;
      };
      ensureLoaded().then(() => check(), () => {});
    }, 6000);
    return () => clearTimeout(timer);
  }, []);
}

export default function NotificationCenter() {
  const [state, setState] = useState('closed'); // closed | open | closing
  const closeTimer = useRef(0);

  // No banners while Focus is on, as in macOS.
  useEffect(() => {
    setQuiet(() => focusPref.get());
  }, []);
  useTasksDueNotice();

  const close = () => {
    setState((s) => (s === 'open' ? 'closing' : s));
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setState((s) => (s === 'closing' ? 'closed' : s)), OUT_MS);
  };
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  useEffect(() => {
    const onToggle = () => {
      clearTimeout(closeTimer.current);
      setState((s) => (s === 'open' ? 'closing' : 'open'));
      closeTimer.current = setTimeout(() => setState((s) => (s === 'closing' ? 'closed' : s)), OUT_MS);
    };
    const onClose = () => closeRef.current();
    window.addEventListener(NC_TOGGLE, onToggle);
    window.addEventListener(NC_CLOSE, onClose);
    return () => {
      window.removeEventListener(NC_TOGGLE, onToggle);
      window.removeEventListener(NC_CLOSE, onClose);
      clearTimeout(closeTimer.current);
    };
  }, []);

  const open = state === 'open';
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(NC_STATE, { detail: { open } }));
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    const onDown = (e) => {
      if (e.target.closest?.('.nc, [data-nc-toggle]')) return;
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open]);

  return (
    <>
      <Banner />
      {state !== 'closed' && <Panel closing={state === 'closing'} onClose={() => closeRef.current()} />}
    </>
  );
}
