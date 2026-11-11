import { describe, expect, it } from 'vitest';
import { addBookmark, moveBookmark, normalizeUrl, removeBookmark, updateBookmark } from '../bookmarks';

const LIST = [
  { websiteName: 'GitHub', url: 'https://github.com/', favicon: 'g', order: 0 },
  { websiteName: 'YouTube', url: 'https://youtube.com/', favicon: 'y', order: 1 },
  { websiteName: 'Reddit', url: 'https://reddit.com/', favicon: 'r', order: 2 },
];

describe('Dock bookmarks', () => {
  it('turns what was typed into a full address', () => {
    expect(normalizeUrl('reddit.com')).toBe('https://reddit.com/');
    expect(normalizeUrl('www.reddit.com')).toBe('https://www.reddit.com/');
    expect(normalizeUrl('x.com/home')).toBe('https://x.com/home');
    expect(normalizeUrl('reddit')).toBe('https://www.reddit.com/');
    expect(normalizeUrl('http://localhost')).toBe(null);
    expect(normalizeUrl('not a site')).toBe(null);
    expect(normalizeUrl('')).toBe(null);
  });

  it('adds at the end, with its icon', () => {
    const { list } = addBookmark(LIST, { name: ' Figma ', url: 'figma.com' });
    expect(list.at(-1)).toEqual({ websiteName: 'Figma', url: 'https://figma.com/', favicon: 'https://www.google.com/s2/favicons?sz=256&domain_url=https://figma.com/', order: 3 });
  });

  it('refuses a missing name, a taken name or a bad address', () => {
    expect(addBookmark(LIST, { name: '', url: 'a.com' }).error).toBe('Enter a name.');
    expect(addBookmark(LIST, { name: 'github', url: 'a.com' }).error).toBe('“github” is already in the Dock.');
    expect(addBookmark(LIST, { name: 'A', url: 'hello world' }).error).toBe('Enter a web address, like reddit.com.');
  });

  it('renames and re-addresses, keeping the icon unless the address changed', () => {
    expect(updateBookmark(LIST, 0, { name: 'GitHub', url: 'https://github.com/' }).list[0].favicon).toBe('g');
    const { list } = updateBookmark(LIST, 1, { name: 'YT', url: 'm.youtube.com' });
    expect(list[1]).toMatchObject({ websiteName: 'YT', url: 'https://m.youtube.com/', order: 1 });
    expect(list[1].favicon).toContain('m.youtube.com');
    expect(updateBookmark(LIST, 1, { name: 'Reddit', url: 'a.com' }).error).toBe('“Reddit” is already in the Dock.');
  });

  it('removes and reorders, renumbering', () => {
    expect(removeBookmark(LIST, 0).list.map((b) => [b.websiteName, b.order])).toEqual([['YouTube', 0], ['Reddit', 1]]);
    expect(moveBookmark(LIST, 2, 0).list.map((b) => b.websiteName)).toEqual(['Reddit', 'GitHub', 'YouTube']);
    expect(moveBookmark(LIST, 0, 9).list).toBe(LIST);
  });
});
