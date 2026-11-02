import { describe, expect, it } from 'vitest';
import { parseChannelInput } from '../channelInput.js';

describe('parseChannelInput', () => {
  it('reads handles, with or without @', () => {
    expect(parseChannelInput('@MrBeast')).toEqual({ kind: 'handle', value: '@MrBeast' });
    expect(parseChannelInput('  veritasium ')).toEqual({ kind: 'handle', value: '@veritasium' });
    expect(parseChannelInput('@café_channel')).toEqual({ kind: 'handle', value: '@café_channel' });
  });

  it('reads channel IDs', () => {
    expect(parseChannelInput('UC_x5XG1OV2P6uZZ5FSM9Ttw')).toEqual({ kind: 'id', value: 'UC_x5XG1OV2P6uZZ5FSM9Ttw' });
  });

  it('reads channel links', () => {
    expect(parseChannelInput('https://www.youtube.com/@GoogleDevelopers/videos')).toEqual({ kind: 'handle', value: '@GoogleDevelopers' });
    expect(parseChannelInput('youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw')).toEqual({ kind: 'id', value: 'UC_x5XG1OV2P6uZZ5FSM9Ttw' });
    expect(parseChannelInput('https://m.youtube.com/user/GoogleDevelopers')).toEqual({ kind: 'username', value: 'GoogleDevelopers' });
    expect(parseChannelInput('https://www.youtube.com/%40caf%C3%A9')).toEqual({ kind: 'handle', value: '@café' });
  });

  it('explains what it can’t look up', () => {
    expect(parseChannelInput('https://www.youtube.com/c/SomeName').error).toMatch(/@handle/);
    expect(parseChannelInput('https://www.youtube.com/watch?v=abc').error).toBeTruthy();
    expect(parseChannelInput('https://evil.example/@x').error).toBeTruthy();
    expect(parseChannelInput('').error).toBeTruthy();
    expect(parseChannelInput('ab').error).toBeTruthy();
    expect(parseChannelInput('has space').error).toBeTruthy();
    expect(parseChannelInput('x'.repeat(300)).error).toBeTruthy();
  });
});
