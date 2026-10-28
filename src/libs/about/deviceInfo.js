// Facts for Settings → About, in the spirit of macOS's About page: the browser and system
// iWeb runs on, its display, and how much storage iWeb's data uses. Everything is read
// locally from the browser; nothing is sent anywhere.

const KB = 1024;

/** "245 KB", "1.2 MB", "3.4 GB". */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < KB) return `${bytes} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / KB;
  let unit = 0;
  while (value >= KB && unit < units.length - 1) {
    value /= KB;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, '')} ${units[unit]}`;
}

/** { name, version } of the browser, from User-Agent Client Hints or the UA string. */
export function describeBrowser(uaData, ua = '') {
  const brands = uaData?.brands || [];
  const real = brands.find((b) => !/not.?a.?brand|chromium/i.test(b.brand))
    || brands.find((b) => /chromium/i.test(b.brand));
  if (real) return { name: real.brand.replace(/^Google /, ''), version: real.version };
  const rules = [
    [/Edg\/([\d.]+)/, 'Microsoft Edge'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/Firefox\/([\d.]+)/, 'Firefox'],
    [/Chrome\/([\d.]+)/, 'Chrome'],
    [/Version\/([\d.]+).*Safari/, 'Safari'],
  ];
  for (const [re, name] of rules) {
    const match = re.exec(ua);
    if (match) return { name, version: match[1].split('.')[0] };
  }
  return { name: 'Browser', version: '' };
}

/** "Windows 11", "macOS", "Android 14"… `platformVersion` comes from the high-entropy hints. */
export function describeOS(uaData, ua = '', platformVersion = '') {
  const platform = uaData?.platform || '';
  if (/windows/i.test(platform) || (!platform && /Windows NT/.test(ua))) {
    // Client hints report Windows 11 as platform version 13 or later.
    const major = Number(String(platformVersion).split('.')[0]);
    if (major >= 13) return 'Windows 11';
    if (major > 0) return 'Windows 10';
    return 'Windows';
  }
  if (/mac/i.test(platform) || (!platform && /Mac OS X/.test(ua))) return 'macOS';
  if (/android/i.test(platform) || (!platform && /Android/.test(ua))) {
    const match = /Android ([\d.]+)/.exec(ua);
    return match ? `Android ${match[1].split('.')[0]}` : 'Android';
  }
  if (/chrome ?os|cros/i.test(platform) || (!platform && /CrOS/.test(ua))) return 'ChromeOS';
  if (/linux/i.test(platform) || (!platform && /Linux/.test(ua))) return 'Linux';
  if (!platform && /iPhone|iPad/.test(ua)) return 'iOS';
  return platform || 'Unknown';
}

/** Gathers everything the About page shows. */
export async function getDeviceInfo(nav = navigator, win = window) {
  const uaData = nav.userAgentData;
  let platformVersion = '';
  try {
    platformVersion = (await uaData?.getHighEntropyValues?.(['platformVersion']))?.platformVersion || '';
  } catch {
    // Hints refused: the OS name stays generic.
  }

  let storage = null;
  try {
    const estimate = await nav.storage?.estimate?.();
    if (estimate) storage = { used: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    // No storage API (older browsers).
  }

  const screen = win.screen || {};
  return {
    browser: describeBrowser(uaData, nav.userAgent),
    os: describeOS(uaData, nav.userAgent, platformVersion),
    cores: nav.hardwareConcurrency || null,
    // deviceMemory is rounded and capped at 8 GB by the browser.
    memoryGB: nav.deviceMemory || null,
    language: nav.language || '',
    display: screen.width ? { width: screen.width, height: screen.height, scale: win.devicePixelRatio || 1 } : null,
    storage,
  };
}
