import { afterEach, describe, expect, it, vi } from 'vitest';
import { authTarget, codeFrom, pkceChallenge, randomToken } from '../creatorAuth.js';

afterEach(() => vi.unstubAllGlobals());

describe('PKCE', () => {
  it('matches the RFC 7636 example', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('makes URL-safe random tokens', () => {
    const a = randomToken(64);
    expect(a).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(randomToken(64)).not.toBe(a);
  });
});

describe('codeFrom', () => {
  const state = 'web.abc';
  it('returns the code for this sign-in', () => {
    expect(codeFrom({ code: 'xyz', state }, state)).toBe('xyz');
  });
  it('rejects another sign-in’s result', () => {
    expect(() => codeFrom({ code: 'xyz', state: 'web.other' }, state)).toThrow(expect.objectContaining({ code: 'STATE_MISMATCH' }));
    expect(() => codeFrom(null, state)).toThrow(expect.objectContaining({ code: 'STATE_MISMATCH' }));
  });
  it('reports cancelled and failed sign-ins', () => {
    expect(() => codeFrom({ error: 'access_denied', state }, state)).toThrow(expect.objectContaining({ code: 'CANCELLED' }));
    expect(() => codeFrom({ error: 'server_error', state }, state)).toThrow(expect.objectContaining({ code: 'AUTH_FAILED' }));
    expect(() => codeFrom({ state }, state)).toThrow(expect.objectContaining({ code: 'AUTH_FAILED' }));
  });
});

describe('authTarget', () => {
  it('is the extension when chrome.identity is there, else the website', () => {
    expect(authTarget()).toBe('web');
    vi.stubGlobal('chrome', { runtime: { id: 'abcdefghijklmnopabcdefghijklmnop' }, identity: { launchWebAuthFlow: () => {} } });
    expect(authTarget()).toBe('ext-abcdefghijklmnopabcdefghijklmnop');
  });
});
