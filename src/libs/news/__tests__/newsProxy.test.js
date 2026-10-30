import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeEntities, parseRss, proxyNews } from '../../../../api/_newsProxy.js';

const item = ({ title, link, guid = 'g1', pubDate = 'Thu, 29 Oct 2026 04:21:30 GMT', source = 'The Hindu', sourceUrl = 'https://www.thehindu.com', description = '' }) => `
  <item>
    <title>${title}</title>
    <link>${link}</link>
    <guid isPermaLink="false">${guid}</guid>
    <pubDate>${pubDate}</pubDate>
    <description>${description}</description>
    <source url="${sourceUrl}">${source}</source>
  </item>`;

const rss = (...items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Top stories</title>${items.join('')}</channel></rss>`;

const related = '&lt;ol&gt;&lt;li&gt;&lt;a href="https://news.google.com/rss/articles/A1" target="_blank"&gt;Cyclone weakens&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;The Hindu&lt;/font&gt;&lt;/li&gt;'
  + '&lt;li&gt;&lt;a href="https://news.google.com/rss/articles/B2" target="_blank"&gt;Flights disrupted &amp;amp; delayed&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;Telegraph India&lt;/font&gt;&lt;/li&gt;&lt;/ol&gt;';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseRss', () => {
  it('normalizes items: publisher suffix removed, entities decoded, related coverage kept', () => {
    const [article] = parseRss(rss(item({
      title: 'Cyclone Arnab to weaken &amp; move north - The Hindu',
      link: 'https://news.google.com/rss/articles/A1',
      description: related,
    })));
    expect(article).toEqual({
      id: 'g1',
      title: 'Cyclone Arnab to weaken & move north',
      url: 'https://news.google.com/rss/articles/A1',
      sourceName: 'The Hindu',
      sourceUrl: 'https://www.thehindu.com/',
      publishedAt: '2026-10-29T04:21:30.000Z',
      // Its own link is not repeated as "other coverage".
      related: [{ title: 'Flights disrupted & delayed', url: 'https://news.google.com/rss/articles/B2', sourceName: 'Telegraph India' }],
    });
  });

  it('drops unusable items: bad links, no headline, no date, duplicates', () => {
    const list = parseRss(rss(
      item({ title: 'Good one', link: 'https://example.com/a', guid: 'a' }),
      item({ title: 'Script link', link: 'javascript:alert(1)', guid: 'b' }),
      item({ title: '', link: 'https://example.com/c', guid: 'c' }),
      item({ title: 'No date', link: 'https://example.com/d', guid: 'd', pubDate: 'not a date' }),
      item({ title: 'Repeat', link: 'https://example.com/a2', guid: 'a' }),
    ));
    expect(list.map((a) => a.title)).toEqual(['Good one']);
  });

  it('unwraps CDATA and strips markup from text', () => {
    const [article] = parseRss(rss(item({ title: '<![CDATA[Markets <b>rally</b>]]>', link: 'https://example.com/x' })));
    expect(article.title).toBe('Markets rally');
    expect(decodeEntities('&#8217;&#x2014;&lt;b&gt;')).toBe('’—<b>');
  });
});

describe('proxyNews', () => {
  const q = (params) => new URLSearchParams(params);

  it('rejects unknown operations, editions, sections and bad queries without calling Google', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await proxyNews(q({ op: 'nope' }))).status).toBe(400);
    expect((await proxyNews(q({ op: 'feed', edition: 'XX:zz' }))).status).toBe(400);
    expect((await proxyNews(q({ op: 'feed', topic: 'GOSSIP' }))).status).toBe(400);
    expect((await proxyNews(q({ op: 'search', q: 'a' }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches the edition and section, and caches at the CDN', async () => {
    const fetchMock = vi.fn(async () => new Response(rss(item({ title: 'Chip news', link: 'https://example.com/chip' })), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await proxyNews(q({ op: 'feed', edition: 'IN:en', topic: 'TECHNOLOGY' }));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('s-maxage=900');
    expect(JSON.parse(res.body).articles.map((a) => a.title)).toEqual(['Chip news']);
    const called = new URL(fetchMock.mock.calls[0][0]);
    expect(called.pathname).toBe('/rss/headlines/section/topic/TECHNOLOGY');
    expect(Object.fromEntries(called.searchParams)).toEqual({ hl: 'en-IN', gl: 'IN', ceid: 'IN:en' });
  });

  it('searches with the query', async () => {
    const fetchMock = vi.fn(async () => new Response(rss(), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await proxyNews(q({ op: 'search', edition: 'US:en', q: '  space   launch ' }));
    expect(JSON.parse(res.body).articles).toEqual([]);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('q')).toBe('space launch');
  });

  it('maps upstream failures without caching them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 429 })));
    const limited = await proxyNews(q({ op: 'feed' }));
    expect(limited.status).toBe(429);
    expect(limited.headers['cache-control']).toBe('no-store');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>oops</html>', { status: 200 })));
    expect(JSON.parse((await proxyNews(q({ op: 'feed' }))).body).error.code).toBe('BAD_RESPONSE');

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect((await proxyNews(q({ op: 'feed' }))).status).toBe(502);
  });
});
