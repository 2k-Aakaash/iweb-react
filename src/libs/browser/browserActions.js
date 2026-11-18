// What iWeb's own right-click menus can ask the browser to do with a link or the page, as
// Chrome's menus would: a new tab (in front or behind), a new window, an incognito window,
// copying, reloading and printing. As the Chrome extension it uses chrome.tabs / chrome.windows
// (no extra permission needed); on the web it falls back to window.open where it can, and
// offers nothing it can't do (a web page can't open an incognito window).
import { notify } from '../notifications/notifications';

const chromeApi = () => {
  const c = globalThis.chrome;
  return c?.windows && c?.tabs ? c : null;
};
const safe = (url) => (typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null);

// Whether Chrome lets iWeb open incognito windows: only when "Allow in Incognito" is on for
// the extension. Asked once at start; null until known (and on the web, false).
let incognitoAllowed = null;
const api = chromeApi();
if (api?.extension?.isAllowedIncognitoAccess) {
  try {
    api.extension.isAllowedIncognitoAccess((allowed) => { incognitoAllowed = Boolean(allowed); });
  } catch {
    incognitoAllowed = false;
  }
} else {
  incognitoAllowed = false;
}

/** Can an "Open in Incognito Window" item be offered at all (the extension, not the web)? */
export const canOfferIncognito = () => Boolean(chromeApi());

export function openInNewTab(url, { background = false } = {}) {
  const u = safe(url);
  if (!u) return;
  const c = chromeApi();
  if (c) c.tabs.create({ url: u, active: !background });
  else window.open(u, '_blank', 'noopener,noreferrer');
}

export function openInNewWindow(url) {
  const u = safe(url);
  if (!u) return;
  const c = chromeApi();
  if (c) c.windows.create({ url: u, focused: true });
  else window.open(u, '_blank', 'noopener,noreferrer,popup');
}

/**
 * Opens the link in an incognito window. If Chrome doesn't allow it yet, says how to turn it
 * on and opens the extension's details page, where the switch is.
 */
export function openInIncognito(url) {
  const u = safe(url);
  const c = chromeApi();
  if (!u || !c) return;
  const explain = () => {
    notify({
      app: 'iweb',
      title: 'Incognito isn’t allowed for iWeb yet',
      body: 'Turn on “Allow in Incognito” on iWeb’s extension page, then try again.',
      key: 'iweb-incognito',
    });
    try {
      c.tabs.create({ url: `chrome://extensions/?id=${c.runtime.id}` });
    } catch {
      // the notification still says what to do
    }
  };
  if (incognitoAllowed === false) {
    explain();
    return;
  }
  c.windows.create({ url: u, incognito: true, focused: true }, () => {
    if (c.runtime.lastError) {
      incognitoAllowed = false;
      explain();
    }
  });
}

export const copyText = (text) => navigator.clipboard?.writeText(text).catch(() => {});

/** The link items Chrome offers on a link, for iWeb's menus. */
export function linkItems(url, { name = null } = {}) {
  return [
    { label: 'Open Link in New Tab', onSelect: () => openInNewTab(url) },
    { label: 'Open Link in New Window', onSelect: () => openInNewWindow(url) },
    { label: 'Open Link in Incognito Window', disabled: !canOfferIncognito(), onSelect: () => openInIncognito(url) },
    { type: 'separator' },
    { label: 'Copy Link Address', onSelect: () => copyText(url) },
    ...(name ? [{ label: 'Copy Name', onSelect: () => copyText(name) }] : []),
  ];
}
