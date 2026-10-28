import { describe, expect, it } from 'vitest';
import { groupLabel, groupNotes, rowDate } from '../groups';

const NOW = new Date(2026, 9, 28, 15, 0).getTime(); // 28 Oct 2026, 3 PM local
const daysAgo = (n, hour = 10) => new Date(2026, 9, 28 - n, hour, 0).getTime();

describe('note groups', () => {
  it('labels sections like macOS Notes', () => {
    expect(groupLabel(daysAgo(0), NOW)).toBe('Today');
    expect(groupLabel(daysAgo(1), NOW)).toBe('Yesterday');
    expect(groupLabel(daysAgo(5), NOW)).toBe('Previous 7 Days');
    expect(groupLabel(daysAgo(20), NOW)).toBe('Previous 30 Days');
    expect(groupLabel(new Date(2026, 5, 3).getTime(), NOW)).toBe(new Date(2026, 5, 3).toLocaleDateString(undefined, { month: 'long' }));
    expect(groupLabel(new Date(2025, 5, 3).getTime(), NOW)).toBe(new Date(2025, 5, 3).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
  });

  it('sorts newest first and groups consecutive notes', () => {
    const notes = [
      { id: 1, updatedAt: daysAgo(5) },
      { id: 2, updatedAt: daysAgo(0, 9) },
      { id: 3, updatedAt: daysAgo(0, 14) },
      { id: 4, updatedAt: daysAgo(1) },
    ];
    const groups = groupNotes(notes, NOW);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Previous 7 Days']);
    expect(groups[0].notes.map((n) => n.id)).toEqual([3, 2]);
  });

  it('shows the time today, "Yesterday", the weekday this week, else a short date', () => {
    expect(rowDate(daysAgo(0, 9), NOW)).toBe(new Date(daysAgo(0, 9)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
    expect(rowDate(daysAgo(1), NOW)).toBe('Yesterday');
    expect(rowDate(daysAgo(3), NOW)).toBe(new Date(daysAgo(3)).toLocaleDateString(undefined, { weekday: 'long' }));
    expect(rowDate(daysAgo(40), NOW)).toBe(new Date(daysAgo(40)).toLocaleDateString(undefined, { day: 'numeric', month: 'numeric', year: '2-digit' }));
  });
});
