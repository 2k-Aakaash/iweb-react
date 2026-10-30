import { describe, expect, it } from 'vitest';
import { dedupeArticles, filterArticles, formatPublishedAt, normalizeArticle, safeUrl } from '../newsArticles';

const raw = (overrides = {}) => ({
  id: 'abc',
  title: 'ISRO launches NVS-03',
  url: 'https://news.google.com/rss/articles/abc',
  sourceName: 'The Hindu',
  sourceUrl: 'https://www.thehindu.com',
  publishedAt: '2026-10-29T04:00:00Z',
  related: [],
  ...overrides,
});

describe('news articles', () => {
  it('accepts only http(s) links', () => {
    expect(safeUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,hi')).toBeNull();
    expect(safeUrl('not a url')).toBeNull();
  });

  it('normalizes, and rejects articles that cannot be shown', () => {
    expect(normalizeArticle(raw({ title: '  Spaced\n  out  ' }))).toMatchObject({ title: 'Spaced out', publishedAt: '2026-10-29T04:00:00.000Z' });
    expect(normalizeArticle(raw({ url: 'javascript:void(0)' }))).toBeNull();
    expect(normalizeArticle(raw({ title: '' }))).toBeNull();
    expect(normalizeArticle(raw({ publishedAt: 'soon' }))).toBeNull();
    expect(normalizeArticle(raw({ sourceName: '' })).sourceName).toBe('Google News');
    // Related coverage with bad links is dropped.
    expect(normalizeArticle(raw({ related: [{ title: 'x', url: 'ftp://a' }, { title: 'y', url: 'https://b.com' }] })).related).toEqual([{ title: 'y', url: 'https://b.com/', sourceName: null }]);
  });

  it('gives a stable id when the source has none', () => {
    const a = normalizeArticle(raw({ id: '' }));
    const b = normalizeArticle(raw({ id: '' }));
    expect(a.id).toMatch(/^u[0-9a-z]+$/);
    expect(a.id).toBe(b.id);
  });

  it('removes duplicates by id and by headline + publisher', () => {
    const list = dedupeArticles([
      raw({ id: '1' }),
      raw({ id: '1', title: 'Other' }),
      raw({ id: '2', title: 'ISRO launches NVS-03!' }), // same words, same publisher
      raw({ id: '3', sourceName: 'NDTV' }), // same headline, other publisher: kept
    ]);
    expect(list.map((a) => a.id)).toEqual(['1', '3']);
  });

  it('searches headline, publisher and coverage locally', () => {
    const list = dedupeArticles([
      raw({ id: '1', title: 'Rupee falls against dollar', sourceName: 'Mint' }),
      raw({ id: '2', title: 'Monsoon update', sourceName: 'NDTV', related: [{ title: 'Rain lashes Mumbai', url: 'https://x.com' }] }),
    ]);
    expect(filterArticles(list, 'rupee').map((a) => a.id)).toEqual(['1']);
    expect(filterArticles(list, 'ndtv').map((a) => a.id)).toEqual(['2']);
    expect(filterArticles(list, 'mumbai rain').map((a) => a.id)).toEqual(['2']);
    expect(filterArticles(list, '')).toHaveLength(2);
  });

  it('labels publication times', () => {
    const now = Date.parse('2026-10-29T12:00:00Z');
    expect(formatPublishedAt('2026-10-29T11:59:40Z', now)).toBe('Just now');
    expect(formatPublishedAt('2026-10-29T11:15:00Z', now)).toBe('45 min ago');
    expect(formatPublishedAt('2026-10-29T07:00:00Z', now)).toBe('5 hr ago');
    expect(formatPublishedAt('bad', now)).toBe('');
  });
});
