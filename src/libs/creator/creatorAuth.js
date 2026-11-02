// Connecting a YouTube channel (Google) or an Instagram professional account (Meta).
//
// Authorization code flow through iWeb's server (api/_creatorProxy.js), which holds the
// client secrets:
//   1. here: a PKCE verifier and a `state` ("<target>.<random>"); the target tells the
//      server's callback where to send the result: this extension or this website
//   2. the server builds the consent URL; it opens in chrome.identity's sign-in window (the
//      extension) or a popup (the website)
//   3. the provider redirects to the server's callback, which passes code + state on: to
//      https://<extension id>.chromiumapp.org/ (caught by chrome.identity) or to this
//      origin's BroadcastChannel
//   4. here: the state must match the one we made, then the code and verifier go to the
//      server, which returns the account and a sealed grant.
// The verifier and state live only in this function's memory.
import { CreatorError, authorizeUrl, exchangeCode } from './creatorApi.js';

const CONSENT_TIMEOUT_MS = 5 * 60 * 1000;
const CHANNEL = 'iweb-creator-auth';
const RESULT_KEY = 'iweb:creatorAuthResult';

function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64url(buf);
}

/** The S256 PKCE challenge of a verifier. */
export async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

// The extension's chrome.identity API (MV3 "identity" permission); absent on the website.
const chromeApi = () => globalThis.chrome;
const extensionAuth = () => typeof chromeApi()?.identity?.launchWebAuthFlow === 'function'
  && /^[a-p]{32}$/.test(chromeApi()?.runtime?.id || '');

/** Where the server's callback should hand the result back: "ext-<id>" or "web". */
export function authTarget() {
  return extensionAuth() ? `ext-${chromeApi().runtime.id}` : 'web';
}

/**
 * The code from a sign-in result, after checking it belongs to this sign-in (`state`).
 * Throws CreatorError CANCELLED / STATE_MISMATCH / AUTH_FAILED.
 */
export function codeFrom(result, state) {
  if (!result || result.state !== state) {
    throw new CreatorError('STATE_MISMATCH', 'That sign-in didn’t come from this window. Try connecting again.');
  }
  if (result.error) {
    throw result.error === 'access_denied' || result.error === 'user_cancelled_authorize' || result.error === 'user_denied'
      ? new CreatorError('CANCELLED', 'Sign-in was cancelled.')
      : new CreatorError('AUTH_FAILED', 'The sign-in didn’t complete. Try again.');
  }
  if (!result.code) throw new CreatorError('AUTH_FAILED', 'The sign-in didn’t complete. Try again.');
  return result.code;
}

function fromRedirectUrl(url) {
  try {
    const params = new URL(url).searchParams;
    return { code: params.get('code'), state: params.get('state'), error: params.get('error') };
  } catch {
    return null;
  }
}

async function consentInExtension(url) {
  let redirect;
  try {
    redirect = await chromeApi().identity.launchWebAuthFlow({ url, interactive: true });
  } catch {
    // Closed by the person, or the page failed to load: chrome.identity doesn't say which.
    throw new CreatorError('CANCELLED', 'Sign-in was closed before it finished.');
  }
  return fromRedirectUrl(redirect);
}

function consentInPopup(url, state, signal) {
  const popup = window.open(url, 'iweb-creator-auth', 'popup=yes,width=520,height=720');
  if (!popup) return Promise.reject(new CreatorError('POPUP_BLOCKED', 'Your browser blocked the sign-in window. Allow pop-ups for iWeb and try again.'));
  return new Promise((resolve, reject) => {
    let channel = null;
    const finish = (fn, value) => {
      clearTimeout(timer);
      channel?.close();
      window.removeEventListener('storage', onStorage);
      signal?.removeEventListener('abort', onAbort);
      fn(value);
    };
    // Only results for this sign-in count; anything else on the channel is ignored.
    const accept = (msg) => {
      if (msg?.type === 'iweb-creator-auth' && msg.state === state) finish(resolve, msg);
    };
    const onStorage = (e) => {
      if (e.key !== RESULT_KEY || !e.newValue) return;
      try {
        accept(JSON.parse(e.newValue));
        localStorage.removeItem(RESULT_KEY);
      } catch {
        // not ours
      }
    };
    const onAbort = () => {
      try {
        popup.close();
      } catch {
        // already gone
      }
      finish(reject, new CreatorError('CANCELLED', 'Sign-in was cancelled.'));
    };
    // The popup can't be watched for closing (the providers' pages cut the link to it), so
    // waiting ends with a result, Cancel, or the timeout.
    const timer = setTimeout(() => finish(reject, new CreatorError('CANCELLED', 'Sign-in timed out.')), CONSENT_TIMEOUT_MS);
    try {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (e) => accept(e.data);
    } catch {
      channel = null;
    }
    window.addEventListener('storage', onStorage);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs the whole sign-in for `platform` and resolves to { account, grant, data }.
 * `revenue` (YouTube) also asks to see revenue reports. Abort `signal` to cancel.
 */
export async function signIn(platform, { revenue = false, currency, signal } = {}) {
  const verifier = randomToken(64);
  const challenge = await pkceChallenge(verifier);
  const state = `${authTarget()}.${randomToken(32)}`;
  const url = await authorizeUrl({ platform, state, challenge, revenue }, { signal });
  const mock = import.meta.env.DEV && url.startsWith('mock:'); // creatorMock.js, dev only
  const result = mock ? { code: 'sample', state }
    : extensionAuth() ? await consentInExtension(url) : await consentInPopup(url, state, signal);
  if (signal?.aborted) throw new CreatorError('CANCELLED', 'Sign-in was cancelled.');
  const code = codeFrom(result, state);
  return exchangeCode({ platform, code, verifier, currency }, { signal });
}
