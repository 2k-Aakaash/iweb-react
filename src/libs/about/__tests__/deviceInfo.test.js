import { describe, expect, it } from 'vitest';
import { describeBrowser, describeOS, formatBytes, getDeviceInfo } from '../deviceInfo';

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const EDGE_WIN = `${CHROME_WIN} Edg/141.0.0.0`;
const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';

describe('about: device info', () => {
  it('formats byte sizes', () => {
    expect(formatBytes(512)).toBe('512 bytes');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1.25 * 1024 * 1024)).toBe('1.3 MB');
    expect(formatBytes(300 * 1024 ** 3)).toBe('300 GB');
    expect(formatBytes(NaN)).toBe('—');
  });

  it('names the browser from client hints, else the UA string', () => {
    const brands = [{ brand: 'Not)A;Brand', version: '8' }, { brand: 'Chromium', version: '141' }, { brand: 'Google Chrome', version: '141' }];
    expect(describeBrowser({ brands }, CHROME_WIN)).toEqual({ name: 'Chrome', version: '141' });
    expect(describeBrowser({ brands: brands.slice(0, 2) })).toEqual({ name: 'Chromium', version: '141' });
    expect(describeBrowser(undefined, EDGE_WIN)).toEqual({ name: 'Microsoft Edge', version: '141' });
    expect(describeBrowser(undefined, SAFARI_MAC)).toEqual({ name: 'Safari', version: '26' });
    expect(describeBrowser(undefined, FIREFOX)).toEqual({ name: 'Firefox', version: '140' });
  });

  it('names the OS, telling Windows 11 from 10', () => {
    expect(describeOS({ platform: 'Windows' }, CHROME_WIN, '15.0.0')).toBe('Windows 11');
    expect(describeOS({ platform: 'Windows' }, CHROME_WIN, '10.0.0')).toBe('Windows 10');
    expect(describeOS({ platform: 'Windows' }, CHROME_WIN)).toBe('Windows');
    expect(describeOS(undefined, SAFARI_MAC)).toBe('macOS');
    expect(describeOS(undefined, FIREFOX)).toBe('Linux');
  });

  it('gathers everything, tolerating missing APIs', async () => {
    const nav = {
      userAgent: CHROME_WIN,
      userAgentData: { platform: 'Windows', brands: [{ brand: 'Google Chrome', version: '141' }], getHighEntropyValues: async () => ({ platformVersion: '19.0.0' }) },
      hardwareConcurrency: 8,
      deviceMemory: 8,
      language: 'en-IN',
      storage: { estimate: async () => ({ usage: 5 * 1024 * 1024, quota: 100 * 1024 ** 3 }) },
    };
    const info = await getDeviceInfo(nav, { screen: { width: 1920, height: 1080 }, devicePixelRatio: 1.25 });
    expect(info).toMatchObject({
      browser: { name: 'Chrome', version: '141' },
      os: 'Windows 11',
      cores: 8,
      memoryGB: 8,
      display: { width: 1920, height: 1080, scale: 1.25 },
      storage: { used: 5 * 1024 * 1024 },
    });
    const bare = await getDeviceInfo({ userAgent: FIREFOX }, {});
    expect(bare).toMatchObject({ os: 'Linux', cores: null, display: null, storage: null });
  });
});
