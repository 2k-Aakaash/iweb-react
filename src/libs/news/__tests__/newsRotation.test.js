import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRotation, nextHeadline } from '../newsRotation';

describe('nextHeadline', () => {
  it('shows every article once per cycle, never the same one twice in a row', () => {
    const ids = ['a', 'b', 'c'];
    let state = { current: 'a', seen: new Set(['a']) };
    const shown = [];
    for (let i = 0; i < 6; i++) {
      const next = nextHeadline(ids, state.current, state.seen);
      expect(next.current).not.toBe(state.current);
      state = next;
      shown.push(state.current);
    }
    expect(shown.slice(0, 2).sort()).toEqual(['b', 'c']);
    expect(new Set(shown.slice(2, 5)).size).toBe(3);
  });

  it('keeps a single article, handles an empty list, and recovers when the current one is gone', () => {
    expect(nextHeadline(['a'], 'a', new Set(['a'])).current).toBe('a');
    expect(nextHeadline([], 'a', new Set()).current).toBeNull();
    expect(nextHeadline(['x', 'y'], 'gone', new Set()).current).toBe('x');
  });
});

describe('createRotation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('changes the headline every 10 seconds using only local articles, never fetching', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    let ids = ['a', 'b', 'c'];
    const onChange = vi.fn();
    const rotation = createRotation({ getIds: () => ids, onChange });
    rotation.start();
    expect(onChange).toHaveBeenLastCalledWith('a');
    vi.advanceTimersByTime(9999);
    expect(onChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenLastCalledWith('b');
    // New articles arriving don't restart the timer or reset the headline.
    ids = ['new', 'a', 'b', 'c'];
    rotation.sync();
    expect(rotation.current).toBe('b');
    vi.advanceTimersByTime(10000);
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(fetchMock).not.toHaveBeenCalled();
    rotation.stop();
  });

  it('keeps one article stable, survives an empty list, and stops cleanly', () => {
    const onChange = vi.fn();
    const single = createRotation({ getIds: () => ['only'], onChange });
    single.start();
    vi.advanceTimersByTime(60000);
    expect(onChange).toHaveBeenCalledTimes(1);
    single.stop();

    const empty = createRotation({ getIds: () => [], onChange: vi.fn() });
    empty.start();
    vi.advanceTimersByTime(30000);
    expect(empty.current).toBeNull();
    empty.stop();
    expect(empty.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never runs two timers when started twice', () => {
    const rotation = createRotation({ getIds: () => ['a', 'b'], onChange: () => {} });
    rotation.start();
    rotation.start();
    expect(vi.getTimerCount()).toBe(1);
    rotation.stop();
  });
});
