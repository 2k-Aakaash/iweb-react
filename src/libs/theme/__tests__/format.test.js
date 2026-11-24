import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  ThemeError,
  cleanTokenValue,
  compareVersions,
  readThemePackage,
  validateManifest,
  validateTokens,
} from '../format.js';
import { sanitizeCss } from '../sanitizeCss.js';
import { cleanPath } from '../paths.js';

const manifest = (over = {}) => ({
  format: 1,
  id: 'paper-ink',
  name: 'Paper & Ink',
  version: '1.0.0',
  author: 'Someone',
  appearance: 'dark',
  ...over,
});

async function zipOf(files, { folder = '' } = {}) {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(folder + path, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return zip.generateAsync({ type: 'uint8array' });
}

const codeOf = async (promise) => {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ThemeError);
    return err.code;
  }
  return 'NO ERROR';
};

describe('package paths', () => {
  it('normalises paths and refuses escapes', () => {
    expect(cleanPath('icons/a.svg')).toBe('icons/a.svg');
    expect(cleanPath('./icons//a.svg')).toBe('icons/a.svg');
    expect(cleanPath('icons\\a.svg')).toBe('icons/a.svg');
    expect(cleanPath('../a.svg')).toBeNull();
    expect(cleanPath('icons/../../a.svg')).toBeNull();
    expect(cleanPath('C:/a.svg')).toBeNull();
    expect(cleanPath('')).toBeNull();
  });
});

describe('theme.json', () => {
  it('accepts a minimal manifest', () => {
    const m = validateManifest(manifest());
    expect(m).toMatchObject({ id: 'paper-ink', version: '1.0.0', appearance: 'dark', fonts: [], previews: [] });
  });

  it('refuses a bad id, the built-in id, a bad version and another format', () => {
    expect(() => validateManifest(manifest({ id: 'Bad Id' }))).toThrow(ThemeError);
    expect(() => validateManifest(manifest({ id: 'iweb' }))).toThrow(/own theme/);
    expect(() => validateManifest(manifest({ version: 'one' }))).toThrow(/version/);
    expect(() => validateManifest(manifest({ format: 2 }))).toThrow(/format/);
  });

  it('strips markup from text and limits its length', () => {
    expect(validateManifest(manifest({ name: '<b>Paper</b>' })).name).toBe('bPaper/b');
    expect(() => validateManifest(manifest({ name: 'x'.repeat(41) }))).toThrow(/40/);
  });

  it('refuses a theme for a newer iWeb', () => {
    expect(() => validateManifest(manifest({ minIweb: '9.0' }), () => true, { iwebVersion: '3.2' })).toThrow(/needs iWeb 9.0/);
    expect(validateManifest(manifest({ minIweb: '3.2' }), () => true, { iwebVersion: '3.2.1' }).minIweb).toBe('3.2');
  });

  it('checks fonts and previews point at files in the package', () => {
    const has = (p) => p === 'fonts/a.woff2' || p === 'preview.png';
    const ok = validateManifest(manifest({ preview: 'preview.png', fonts: [{ family: 'Paper Serif', src: 'fonts/a.woff2', weight: 700 }] }), has);
    expect(ok.fonts[0]).toEqual({ family: 'Paper Serif', src: 'fonts/a.woff2', weight: '700', style: 'normal' });
    expect(() => validateManifest(manifest({ fonts: [{ family: 'X', src: 'fonts/missing.woff2' }] }), has)).toThrow(/isn't a font file/);
    expect(() => validateManifest(manifest({ fonts: [{ family: 'X;}', src: 'fonts/a.woff2' }] }), has)).toThrow(/family/);
  });

  it('compares versions', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('2.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0')).toBe(0);
  });
});

describe('tokens.json', () => {
  it('accepts known tokens with plain values', () => {
    const t = validateTokens({ tokens: { 'font-ui': '"Paper Serif", Georgia, serif', '--iw-radius-window': '6px' }, accent: '196, 54, 45' });
    expect(t.tokens).toEqual({ 'font-ui': '"Paper Serif", Georgia, serif', 'radius-window': '6px' });
    expect(t.accent).toBe('196 54 45');
  });

  it('refuses unknown tokens and values that could break out or load something', () => {
    expect(() => validateTokens({ tokens: { 'not-a-token': '1px' } })).toThrow(/isn't a token/);
    for (const bad of ['1px; } body { display: none', 'url(https://x.test/a.png)', 'red</style>', '\\75 rl(x)', '"unclosed', 'calc(1px', 'image-set("x.png")']) {
      expect(cleanTokenValue(bad), bad).toBeNull();
    }
    expect(cleanTokenValue('cubic-bezier(0.2, 0.8, 0.2, 1)')).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)');
  });

  it('checks glass looks, icons, names and the wallpaper', () => {
    const has = (p) => ['icons/ledger.svg', 'wallpapers/plains.jpg'].includes(p);
    const t = validateTokens({
      glass: { window: { tint: [300, 10, 10, 2], blur: 999 } },
      icons: { settings: 'icons/ledger.svg' },
      names: { settings: 'Ledger' },
      wallpaper: 'wallpapers/plains.jpg',
    }, has);
    expect(t.glass.window).toEqual({ tint: [255, 10, 10, 1], blur: 60 });
    expect(t.icons).toEqual({ settings: 'icons/ledger.svg' });
    expect(t.names).toEqual({ settings: 'Ledger' });
    expect(t.wallpaper).toBe('wallpapers/plains.jpg');
    expect(() => validateTokens({ glass: { window: { evil: 1 } } })).toThrow(/glass setting/);
    expect(() => validateTokens({ names: { finder: 'X' } })).toThrow(/rename/);
    expect(() => validateTokens({ icons: { settings: 'icons/missing.svg' } }, has)).toThrow(/isn't an image/);
    expect(() => validateTokens({ wallpaper: 'icons/ledger.svg' }, has)).toThrow(/wallpaper/);
  });
});

describe('tokens.json glassEffect', () => {
  it('is on unless the theme turns it off', () => {
    expect(validateTokens({}).glassEffect).toBe('on');
    expect(validateTokens({ glassEffect: 'off' }).glassEffect).toBe('off');
    expect(() => validateTokens({ glassEffect: 'none' })).toThrow(/on" or "off/);
  });
});

describe('tokens.json sounds', () => {
  const has = (p) => p === 'sounds/open.ogg' || p === 'img/a.png';
  it('accepts the sounds iWeb plays, from audio files in the package', () => {
    expect(validateTokens({ sounds: { open: 'sounds/open.ogg' } }, has).sounds).toEqual({ open: 'sounds/open.ogg' });
  });
  it('refuses other events, other file types and missing files', () => {
    expect(() => validateTokens({ sounds: { click: 'sounds/open.ogg' } }, has)).toThrow(/isn't a sound iWeb plays/);
    expect(() => validateTokens({ sounds: { open: 'img/a.png' } }, has)).toThrow(/OGG, MP3 or WAV/);
    expect(() => validateTokens({ sounds: { open: 'sounds/missing.ogg' } }, has)).toThrow(/OGG, MP3 or WAV/);
  });
  it('refuses a long sound', async () => {
    const zip = await zipOf({ 'theme.json': manifest(), 'tokens.json': { sounds: { open: 'open.wav' } }, 'open.wav': 'x'.repeat(1024 * 1024 + 1) });
    expect(await codeOf(readThemePackage(zip, JSZip))).toBe('TOO_BIG');
  });
});

describe('skin.css', () => {
  const has = (p) => p === 'fonts/a.woff2' || p === 'img/paper.png';

  it('keeps ordinary styling and points package files at the theme', () => {
    const { css, removed } = sanitizeCss(`
      @font-face { font-family: "Paper"; src: url(fonts/a.woff2) format("woff2"); }
      [data-iw="window"] { background: url('img/paper.png') center / cover; border-radius: 4px; }
      @media (max-width: 600px) { [data-iw="dock"] { gap: 2px; } }
      .x { content: "\\201C"; filter: url(#iweb-clock-glass); }
    `, { hasFile: has });
    expect(removed).toEqual([]);
    expect(css).toContain('url("iwtheme:fonts/a.woff2")');
    expect(css).toContain('url("iwtheme:img/paper.png")');
    expect(css).toContain('url(#iweb-clock-glass)');
    expect(css).toContain('content: "\\201C"');
  });

  it('drops anything that loads from outside the package or runs code', () => {
    const { css, removed } = sanitizeCss(`
      @import url(https://evil.test/a.css);
      @namespace svg url(http://www.w3.org/2000/svg);
      .a { background: url(https://evil.test/track.png); color: red; }
      .b { background: url(../outside.png); }
      .c { background: url(missing.png); }
      .d { width: expression(alert(1)); }
      .e { background: \\75 rl(https://evil.test/x.png); }
      .f { background-image: image-set("https://evil.test/x.png" 1x); }
      .g { -moz-binding: url(x.xml#a); behavior: url(x.htc); }
      .h { background: url("javascript:alert(1)"); }
    `, { hasFile: has });
    expect(css).not.toMatch(/evil|outside|missing|expression|javascript|binding|behavior|\\75|@import|@namespace/);
    expect(css).toContain('color: red');
    expect(removed.length).toBeGreaterThanOrEqual(10);
  });

  it('allows small data: images only', () => {
    const ok = sanitizeCss('.a { background: url("data:image/png;base64,AAAA"); }').css;
    expect(ok).toContain('data:image/png');
    expect(sanitizeCss('.a { background: url("data:text/html,<script>"); }').css).not.toContain('data:text');
  });
});

describe('readThemePackage', () => {
  it('reads a package, also wrapped in a folder (GitHub zips)', async () => {
    const files = {
      'theme.json': manifest({ preview: 'preview.png' }),
      'tokens.json': { tokens: { 'radius-window': '4px' }, icons: { settings: 'icons/s.svg' } },
      'skin.css': '[data-iw="window"] { background: url(img/paper.png); }',
      'preview.png': 'png',
      'icons/s.svg': '<svg/>',
      'img/paper.png': 'png',
      'img/unused.png': 'png',
      'README.md': '# Paper',
    };
    for (const folder of ['', 'paper-ink-1.0.0/']) {
      const pkg = await readThemePackage(await zipOf(files, { folder }), JSZip);
      expect(pkg.manifest.id).toBe('paper-ink');
      expect(pkg.tokens.tokens['radius-window']).toBe('4px');
      expect(pkg.css).toContain('url("iwtheme:img/paper.png")');
      // Only the files the theme uses are kept.
      expect(Object.keys(pkg.files).sort()).toEqual(['icons/s.svg', 'img/paper.png', 'preview.png']);
      expect(pkg.files['img/paper.png'].type).toBe('image/png');
    }
  });

  it('refuses scripts, pages, unsafe names, a missing manifest and non-zips', async () => {
    expect(await codeOf(readThemePackage(await zipOf({ 'theme.json': manifest(), 'evil.js': 'alert(1)' }), JSZip))).toBe('BAD_FILE_TYPE');
    expect(await codeOf(readThemePackage(await zipOf({ 'theme.json': manifest(), 'page.html': '<p>' }), JSZip))).toBe('BAD_FILE_TYPE');
    expect(await codeOf(readThemePackage(await zipOf({ 'README.md': '#' }), JSZip))).toBe('NO_MANIFEST');
    expect(await codeOf(readThemePackage(new TextEncoder().encode('not a zip'), JSZip))).toBe('NOT_A_ZIP');
    expect(await codeOf(readThemePackage(await zipOf({ 'theme.json': '{oops' }), JSZip))).toBe('BAD_JSON');
  });
});
