// Opening the News app (App.jsx listens) and opening article links safely.
import { safeUrl } from './newsArticles';

export const NEWS_OPEN_EVENT = 'news:open';

/** Opens the News app; from the Dock icon it comes back as it was left. */
export function openNews() {
  window.dispatchEvent(new CustomEvent(NEWS_OPEN_EVENT));
}

/** Opens an article (http/https only) in a new tab, keeping iWeb as it is. */
export function openArticle(url) {
  const safe = safeUrl(url);
  if (!safe) return false;
  // In the extension, a real tab; on the website, a new window with no opener.
  const tabs = globalThis.chrome?.tabs;
  if (tabs?.create) {
    tabs.create({ url: safe, active: true });
  } else {
    window.open(safe, '_blank', 'noopener,noreferrer');
  }
  return true;
}
