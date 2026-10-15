import { describe, expect, it } from 'vitest';
import {
  MAX_CHART_POINTS,
  areaPath,
  boundaryTicks,
  downsampleIndices,
  extent,
  formatInZone,
  formatPointTime,
  formatTickLabel,
  intradayTicks,
  layoutChart,
  linePath,
  linearScale,
  nearestIndex,
  padDomain,
  prepareSeries,
  resolveTimeZone,
  spaceTicks,
  thinTicks,
  zoneAbbreviation,
  zonedParts,
  zonedTimeToEpoch,
} from '../chartMath.js';

const IST = 'Asia/Kolkata';
// Epoch seconds for a wall-clock time in IST (UTC+5:30, no DST).
const ist = (year, month, day, hour, minute = 0) => Date.UTC(year, month - 1, day, hour, minute) / 1000 - 19800;

// 5-minute bars from 9:15 to `endHour:endMinute` IST on 15 Oct 2026.
function intraday(endHour, endMinute) {
  const points = [];
  for (let t = ist(2026, 10, 15, 9, 15), i = 0; t <= ist(2026, 10, 15, endHour, endMinute); t += 300, i += 1) {
    points.push([t, 22600 + Math.sin(i / 4) * 40 + i]);
  }
  return points;
}

describe('numbers', () => {
  it('finds the extent, ignoring non-finite values', () => {
    expect(extent([3, 1, Number.NaN, 2])).toEqual([1, 3]);
    expect(extent([])).toBeNull();
  });

  it('pads a domain, and gives a flat series some height', () => {
    expect(padDomain([10, 20], 0.1)).toEqual([9, 21]);
    expect(padDomain([100, 100])).toEqual([99, 101]);
    expect(padDomain([0, 0])).toEqual([-1, 1]);
  });

  it('maps and inverts linear scales, including flipped and empty domains', () => {
    const scale = linearScale([0, 10], [0, 100]);
    expect(scale(5)).toBe(50);
    expect(scale.invert(50)).toBe(5);
    expect(linearScale([0, 10], [100, 0])(2.5)).toBe(75);
    const flat = linearScale([4, 4], [0, 100]);
    expect(flat(4)).toBe(50);
    expect(flat.invert(80)).toBe(4);
  });

  it('looks up the nearest point by binary search', () => {
    const xs = [0, 10, 20, 30];
    expect(nearestIndex(xs, 14)).toBe(1);
    expect(nearestIndex(xs, 16)).toBe(2);
    expect(nearestIndex(xs, 15)).toBe(1);
    expect(nearestIndex(xs, -5)).toBe(0);
    expect(nearestIndex(xs, 99)).toBe(3);
    expect(nearestIndex(xs, 20)).toBe(2);
    expect(nearestIndex([], 3)).toBe(-1);
  });
});

describe('downsampling', () => {
  it('keeps every point when there are few enough', () => {
    expect(downsampleIndices([5, 6, 7])).toEqual([0, 1, 2]);
  });

  it(`reduces long series to ${MAX_CHART_POINTS} points, keeping the ends and the spikes`, () => {
    const values = Array.from({ length: 2000 }, (_, i) => 100 + Math.sin(i / 50));
    values[1234] = 500;
    values[777] = -300;
    const picked = downsampleIndices(values);
    expect(picked).toHaveLength(MAX_CHART_POINTS);
    expect(picked[0]).toBe(0);
    expect(picked[picked.length - 1]).toBe(1999);
    expect(picked.every((index, i) => i === 0 || index > picked[i - 1])).toBe(true);
    expect(picked).toContain(1234);
    expect(picked).toContain(777);
  });

  it('never goes below three points', () => {
    expect(downsampleIndices([1, 2, 3, 4, 5, 6], 1)).toHaveLength(3);
  });
});

describe('time zones', () => {
  it('reads wall-clock parts in the exchange time zone', () => {
    expect(zonedParts(ist(2026, 10, 15, 9, 15), IST)).toMatchObject({ year: 2026, month: 10, day: 15, hour: 9, minute: 15 });
    expect(zonedParts(Date.UTC(2026, 9, 15, 20, 0) / 1000, IST)).toMatchObject({ day: 16, hour: 1, minute: 30 });
  });

  it('converts wall-clock times back to epoch seconds across DST', () => {
    expect(zonedTimeToEpoch({ year: 2026, month: 10, day: 15, hour: 9, minute: 15 }, IST)).toBe(ist(2026, 10, 15, 9, 15));
    // New York: EST (UTC−5) in January, EDT (UTC−4) after 8 March 2026.
    expect(zonedTimeToEpoch({ year: 2026, month: 1, day: 15, hour: 9, minute: 30 }, 'America/New_York')).toBe(Date.UTC(2026, 0, 15, 14, 30) / 1000);
    expect(zonedTimeToEpoch({ year: 2026, month: 3, day: 9, hour: 9, minute: 30 }, 'America/New_York')).toBe(Date.UTC(2026, 2, 9, 13, 30) / 1000);
  });

  it('falls back to IST for unknown zones', () => {
    expect(resolveTimeZone('Not/A_Zone')).toBe(IST);
    expect(resolveTimeZone(null)).toBe(IST);
    expect(resolveTimeZone('Europe/London')).toBe('Europe/London');
  });

  it('formats clock times with plain spaces and short zone names', () => {
    const close = ist(2026, 10, 15, 15, 30);
    expect(formatInZone(close, IST, { hour: 'numeric', minute: '2-digit' })).toBe('3:30 PM');
    expect(zoneAbbreviation(close, IST)).toBe('IST');
    expect(zoneAbbreviation(close, 'America/New_York')).toBe('EDT');
    expect(zoneAbbreviation(Date.UTC(2026, 0, 15) / 1000, 'America/New_York')).toBe('EST');
  });
});

describe('ticks', () => {
  const open = ist(2026, 10, 15, 9, 15);
  const close = ist(2026, 10, 15, 15, 30);

  it('places hourly ticks on round exchange-local hours', () => {
    const ticks = intradayTicks(open, close, IST, 7);
    expect(ticks).toEqual([10, 11, 12, 13, 14, 15].map((hour) => ist(2026, 10, 15, hour)));
    expect(ticks.map((t) => formatTickLabel(t, 'time', IST))).toEqual(['10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM']);
  });

  it('widens the step when there is less room', () => {
    expect(intradayTicks(open, close, IST, 3)).toEqual([ist(2026, 10, 15, 12), ist(2026, 10, 15, 15)]);
    expect(intradayTicks(close, open, IST, 5)).toEqual([]);
  });

  it('marks day boundaries (with the first day) and month boundaries', () => {
    const days = [];
    for (let day = 12; day <= 16; day += 1) {
      for (let hour = 9; hour < 16; hour += 1) days.push(ist(2026, 10, day, hour, 15));
    }
    expect(boundaryTicks(days, 'day', IST, { includeFirst: true })).toEqual([0, 7, 14, 21, 28]);

    const daily = [];
    for (let t = ist(2026, 8, 20, 15, 30); t <= ist(2026, 10, 15, 15, 30); t += 86400) daily.push(t);
    const months = boundaryTicks(daily, 'month', IST);
    expect(months.map((index) => zonedParts(daily[index], IST))).toMatchObject([{ month: 9, day: 1 }, { month: 10, day: 1 }]);
  });

  it('thins ticks by count and by spacing', () => {
    expect(thinTicks([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([1, 4, 7]);
    expect(thinTicks([1, 2], 5)).toEqual([1, 2]);
    expect(spaceTicks([{ x: 0 }, { x: 30 }, { x: 60 }, { x: 130 }], 50)).toEqual([{ x: 0 }, { x: 60 }, { x: 130 }]);
  });

  it('formats axis and crosshair labels in the exchange time zone', () => {
    const t = ist(2026, 10, 15, 14, 15);
    expect(formatTickLabel(ist(2026, 10, 15, 10, 30), 'time', IST)).toBe('10:30 AM');
    expect(formatTickLabel(t, 'weekday', IST)).toBe('Thu 15');
    expect(formatTickLabel(t, 'day', IST)).toBe('15 Oct');
    expect(formatTickLabel(t, 'month', IST)).toBe('Oct');
    expect(formatTickLabel(ist(2026, 1, 2, 15, 30), 'month', IST)).toBe('2026');
    expect(formatTickLabel(t, 'year', IST)).toBe('2026');
    expect(formatPointTime(t, '1d', IST)).toBe('2:15 PM');
    expect(formatPointTime(t, '5d', IST)).toBe('Thu, 15 Oct, 2:15 PM');
    expect(formatPointTime(t, '1y', IST)).toBe('15 Oct 2026');
    // The same instant on a New York exchange clock.
    expect(formatPointTime(t, '1d', 'America/New_York')).toBe('4:45 AM');
  });
});

describe('chart model', () => {
  const session = { start: ist(2026, 10, 15, 9, 15), end: ist(2026, 10, 15, 15, 30) };

  it('returns null when there is nothing to draw', () => {
    expect(prepareSeries({ points: [], rangeId: '1d', timeZone: IST })).toBeNull();
    expect(prepareSeries({ points: [[1, Number.NaN]], rangeId: '1d', timeZone: IST })).toBeNull();
  });

  it('lays out a live 1D chart inside the full session, with the previous-close line', () => {
    const points = intraday(12, 0);
    const series = prepareSeries({ points, rangeId: '1d', timeZone: IST, reference: 22500, includeReference: true, session });
    expect(series.xDomain).toEqual([session.start, session.end]);
    expect(series.yDomain[0]).toBeLessThan(22500);

    const model = layoutChart(series, { width: 600, height: 260 });
    const { plot } = model;
    expect(model.points[0].x).toBeCloseTo(plot.left);
    // 12:00 is 165 of the session's 375 minutes.
    expect(model.points[model.points.length - 1].x).toBeCloseTo(plot.left + (plot.right - plot.left) * (165 / 375));
    expect(model.referenceY).toBeGreaterThan(plot.top);
    expect(model.referenceY).toBeLessThan(plot.bottom);
    expect(model.ticks.map((tick) => tick.label)).toEqual(['10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM']);
    const [high, low] = model.yLabels;
    expect(high.value).toBe(series.max);
    expect(low.value).toBe(series.min);
    expect(high.y).toBeLessThan(low.y);
    expect(model.line.startsWith('M')).toBe(true);
    expect(model.area.endsWith('Z')).toBe(true);
  });

  it('uses the data extent when the session does not cover the points (before the open)', () => {
    const points = intraday(15, 30);
    const tomorrow = { start: session.start + 86400, end: session.end + 86400 };
    const series = prepareSeries({ points, rangeId: '1d', timeZone: IST, session: tomorrow });
    expect(series.xDomain).toEqual([points[0][0], points[points.length - 1][0]]);
    expect(series.drawReference).toBe(false);
  });

  it('spaces longer ranges by index and downsamples to the point budget', () => {
    const points = Array.from({ length: 2000 }, (_, i) => [ist(2021, 1, 1, 15, 30) + i * 86400, 100 + i]);
    const series = prepareSeries({ points, rangeId: '5y', timeZone: IST, reference: 90 });
    expect(series.xDomain).toEqual([0, 1999]);
    expect(series.reference).toBe(90);
    expect(series.drawReference).toBe(false);

    const model = layoutChart(series, { width: 800, height: 260 });
    expect(model.points).toHaveLength(MAX_CHART_POINTS);
    expect(model.points[0].x).toBeCloseTo(model.plot.left);
    expect(model.points[model.points.length - 1].x).toBeCloseTo(model.plot.right);
    expect(model.xs.every((x, i) => i === 0 || x > model.xs[i - 1])).toBe(true);
    expect(model.ticks.map((tick) => tick.label)).toEqual(['2022', '2023', '2024', '2025', '2026']);
  });

  it('labels the first day of a 5D chart and keeps labels apart', () => {
    const points = [];
    for (let day = 9; day <= 15; day += 1) {
      if (day === 10 || day === 11) continue; // weekend
      for (let minute = 0; minute <= 375; minute += 30) points.push([ist(2026, 10, day, 9, 15) + minute * 60, 22000 + minute]);
    }
    const model = layoutChart(prepareSeries({ points, rangeId: '5d', timeZone: IST }), { width: 520, height: 260 });
    expect(model.ticks.map((tick) => tick.label)).toEqual(['Fri 9', 'Mon 12', 'Tue 13', 'Wed 14', 'Thu 15']);
    expect(model.ticks[0].anchor).toBe('start');
  });

  it('builds SVG paths', () => {
    const pts = [{ x: 0, y: 10 }, { x: 5.04, y: 2.96 }];
    expect(linePath(pts)).toBe('M0,10L5,3');
    expect(areaPath(pts, 20)).toBe('M0,10L5,3L5,20L0,20Z');
    expect(areaPath([], 20)).toBe('');
  });
});
