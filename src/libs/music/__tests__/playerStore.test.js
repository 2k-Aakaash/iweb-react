import { describe, expect, it, vi } from 'vitest';
import { getPlayer, nextTrack, publishPlayer, registerPlayerController, setPlayerVolume } from '../playerStore.js';

describe('music player store', () => {
  it('publishes only real changes and keeps the same track object', () => {
    publishPlayer({ available: true, track: { title: 'Besties', artist: 'BCNR', artwork: 'a.jpg' }, playing: true });
    const first = getPlayer();
    publishPlayer({ available: true, track: { title: 'Besties', artist: 'BCNR', artwork: 'a.jpg' }, playing: true });
    expect(getPlayer()).toBe(first); // a new object with the same track: no change
    publishPlayer({ playing: false });
    expect(getPlayer()).not.toBe(first);
    expect(getPlayer().track).toBe(first.track);
  });

  it('sends commands to the registered player', () => {
    const ref = { current: { next: vi.fn(), setVolume: vi.fn() } };
    const unregister = registerPlayerController(ref);
    nextTrack();
    setPlayerVolume(140);
    expect(ref.current.next).toHaveBeenCalledOnce();
    expect(ref.current.setVolume).toHaveBeenCalledWith(100);
    unregister();
    nextTrack(); // nobody listening: nothing happens
    expect(ref.current.next).toHaveBeenCalledOnce();
  });
});
