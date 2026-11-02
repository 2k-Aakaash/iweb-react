import { useEffect, useState } from 'react';
import { dayKey } from './tasks';

// Today's date for Notes (the Today view, due-date labels, "Yesterday" sections), kept in
// state so rendering stays pure, and moved on at midnight or when the tab comes back.

function snapshot() {
  const d = new Date();
  return { today: dayKey(d), now: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime() };
}

export function useToday() {
  const [value, setValue] = useState(snapshot);
  useEffect(() => {
    let timer;
    const check = () => setValue((prev) => {
      const next = snapshot();
      return next.today === prev.today ? prev : next;
    });
    const schedule = () => {
      const d = new Date();
      const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 5).getTime();
      timer = setTimeout(() => {
        check();
        schedule();
      }, Math.min(midnight - d.getTime(), 60 * 60 * 1000));
    };
    schedule();
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return value;
}
