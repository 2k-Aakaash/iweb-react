import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPolling } from '../polling.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('startPolling', () => {
  it('runs at once, then again after the delay each run resolves to, until one resolves null', async () => {
    vi.useFakeTimers();
    const delays = [1000, 5000, null];
    const task = vi.fn(async () => delays.shift());
    const stop = startPolling(task);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60000);
    expect(task).toHaveBeenCalledTimes(3);
    stop();
  });

  it('aborts the request in flight and never reschedules after stopping', async () => {
    vi.useFakeTimers();
    let signal;
    let resolve;
    const task = vi.fn((s) => {
      signal = s;
      return new Promise((r) => {
        resolve = r;
      });
    });
    const stop = startPolling(task);
    stop();
    expect(signal.aborted).toBe(true);
    resolve(1000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('stops quietly when a task throws or rejects', async () => {
    vi.useFakeTimers();
    const throwing = vi.fn(() => {
      throw new Error('boom');
    });
    expect(() => startPolling(throwing)()).not.toThrow();
    const rejecting = vi.fn(async () => {
      throw new Error('boom');
    });
    const stop = startPolling(rejecting);
    await vi.advanceTimersByTimeAsync(60000);
    expect(rejecting).toHaveBeenCalledTimes(1);
    stop();
  });
});
