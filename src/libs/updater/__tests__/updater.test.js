import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function release(tag, { sha = true } = {}) {
  const assets = [{ name: 'iWeb.Extension.zip', browser_download_url: `https://github.com/x/releases/download/${tag}/iWeb.Extension.zip`, size: 1000 }];
  if (sha) assets.push({ name: 'iWeb.Extension.zip.sha256', browser_download_url: `https://github.com/x/releases/download/${tag}/iWeb.Extension.zip.sha256` });
  return { tag_name: tag, name: tag, body: 'notes', html_url: `https://github.com/x/releases/tag/${tag}`, published_at: '2026-10-14T00:00:00Z', assets };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function loadUpdater(tag) {
  vi.resetModules();
  vi.stubEnv('VITE_IWEB_RELEASE_TAG', tag);
  return import('../updater.js');
}

let store;
let fetchMock;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('updater', () => {
  it('parses build numbers from release tags', async () => {
    const { parseBuildNumber } = await loadUpdater('');
    expect(parseBuildNumber('v1.0.0-build.12')).toBe(12);
    expect(parseBuildNumber('v2.0.2alpha')).toBeNull();
    expect(parseBuildNumber('')).toBeNull();
  });

  it('reports an update when the latest build is newer', async () => {
    const { checkForUpdate } = await loadUpdater('v1.0.0-build.3');
    fetchMock.mockResolvedValueOnce(jsonResponse(release('v1.0.0-build.5')));
    const status = await checkForUpdate();
    expect(status.available).toBe(true);
    expect(status.latest).toMatchObject({ tag: 'v1.0.0-build.5', build: 5 });
    expect(status.latest.shaUrl).toMatch(/\.sha256$/);
  });

  it('is up to date when the latest build is the same or older', async () => {
    const { checkForUpdate } = await loadUpdater('v1.0.0-build.5');
    fetchMock.mockResolvedValueOnce(jsonResponse(release('v1.0.0-build.5')));
    expect((await checkForUpdate()).available).toBe(false);
  });

  it('never offers updates to local development builds', async () => {
    const { checkForUpdate, getUpdateMode } = await loadUpdater('');
    fetchMock.mockResolvedValueOnce(jsonResponse(release('v1.0.0-build.9')));
    expect((await checkForUpdate()).available).toBe(false);
    expect(getUpdateMode()).toBe('web'); // no chrome.runtime in node
  });

  it('reads the build number from the release name when the tag has none', async () => {
    const { checkForUpdate } = await loadUpdater('v1.0.0-build.2');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...release('v2.2'), name: 'iWeb v2.2-build.3' }));
    const status = await checkForUpdate();
    expect(status.latest).toMatchObject({ tag: 'v2.2', build: 3, name: 'iWeb v2.2-build.3' });
    expect(status.available).toBe(true);
  });

  it('ignores releases that are not workflow builds', async () => {
    const { checkForUpdate } = await loadUpdater('v1.0.0-build.1');
    fetchMock.mockResolvedValueOnce(jsonResponse(release('v2.0.2alpha')));
    const status = await checkForUpdate();
    expect(status.latest).toBeNull();
    expect(status.available).toBe(false);
  });

  it('caches the check for 6 hours unless forced', async () => {
    const { checkForUpdate } = await loadUpdater('v1.0.0-build.1');
    fetchMock.mockImplementation(async () => jsonResponse(release('v1.0.0-build.2')));
    await checkForUpdate();
    await checkForUpdate();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await checkForUpdate({ force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps GitHub rate limiting to RATE_LIMITED', async () => {
    const { checkForUpdate } = await loadUpdater('v1.0.0-build.1');
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'API rate limit exceeded' }, 403));
    await expect(checkForUpdate()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('remembers a dismissed tag', async () => {
    const { dismissUpdate, isDismissed } = await loadUpdater('v1.0.0-build.1');
    dismissUpdate('v1.0.0-build.2');
    expect(isDismissed('v1.0.0-build.2')).toBe(true);
    expect(isDismissed('v1.0.0-build.3')).toBe(false);
  });
});
