/**
 * Tiny RSS 2.0 / Atom / JSON Feed / sitemap.xml renderers — zero deps.
 *
 * For more advanced needs (categories, enclosures, paginated feeds) reach
 * for `feed` (npm) or `@vercel/og` + a templating layer. These ~150 LOC
 * cover 90% of blog-style content sites.
 */

export interface FeedPost {
  slug: string;
  title: string;
  url: string;
  date: string | null;
  body: string;
  summary?: string;
}

export interface FeedMeta {
  title: string;
  description: string;
  siteUrl: string;
  feedUrl: string;
  language?: string;
  author?: { name: string, email?: string };
}

/** XML-escape helper. Treats `&`, `<`, `>`, `"`, `'`. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isoDate(input: string | null): string {
  if (!input) return new Date().toISOString();
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function rfc822(input: string | null): string {
  if (!input) return new Date().toUTCString();
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
}

export function renderRss2(posts: FeedPost[], meta: FeedMeta): string {
  const items = posts
    .map(
      post =>
        `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(post.url)}</link>
      <guid isPermaLink="true">${escapeXml(post.url)}</guid>
      <pubDate>${rfc822(post.date)}</pubDate>
      <description><![CDATA[${post.summary ?? post.body.slice(0, 300)}]]></description>
      <content:encoded><![CDATA[${post.body}]]></content:encoded>
    </item>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(meta.title)}</title>
    <link>${escapeXml(meta.siteUrl)}</link>
    <description>${escapeXml(meta.description)}</description>
    <language>${escapeXml(meta.language ?? 'en')}</language>
    <atom:link href="${escapeXml(meta.feedUrl)}" rel="self" type="application/rss+xml" />
    <generator>LaikaCMS RSS starter</generator>
${items}
  </channel>
</rss>`;
}

export function renderAtom(posts: FeedPost[], meta: FeedMeta): string {
  const entries = posts
    .map(
      post =>
        `  <entry>
    <title>${escapeXml(post.title)}</title>
    <link href="${escapeXml(post.url)}" />
    <id>${escapeXml(post.url)}</id>
    <updated>${isoDate(post.date)}</updated>
    <summary>${escapeXml(post.summary ?? post.body.slice(0, 300))}</summary>
    <content type="html"><![CDATA[${post.body}]]></content>
  </entry>`,
    )
    .join('\n');

  const updated = posts[0]?.date ? isoDate(posts[0].date) : new Date().toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(meta.title)}</title>
  <link href="${escapeXml(meta.siteUrl)}" rel="alternate" />
  <link href="${escapeXml(meta.feedUrl)}" rel="self" />
  <id>${escapeXml(meta.siteUrl)}</id>
  <updated>${updated}</updated>
  <subtitle>${escapeXml(meta.description)}</subtitle>
  ${
    meta.author
      ? `<author><name>${escapeXml(meta.author.name)}</name>${
        meta.author.email ? `<email>${escapeXml(meta.author.email)}</email>` : ''
      }</author>`
      : ''
  }
${entries}
</feed>`;
}

/** https://jsonfeed.org/version/1.1 — the new-school feed format. */
export function renderJsonFeed(posts: FeedPost[], meta: FeedMeta): unknown {
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: meta.title,
    description: meta.description,
    home_page_url: meta.siteUrl,
    feed_url: meta.feedUrl,
    language: meta.language ?? 'en',
    items: posts.map(post => ({
      id: post.url,
      url: post.url,
      title: post.title,
      content_text: post.body,
      summary: post.summary ?? post.body.slice(0, 300),
      date_published: isoDate(post.date),
    })),
  };
}

export function renderSitemap(posts: FeedPost[], siteUrl: string): string {
  const urls = posts
    .map(
      post =>
        `  <url>
    <loc>${escapeXml(post.url)}</loc>
    ${post.date ? `<lastmod>${escapeXml(isoDate(post.date).slice(0, 10))}</lastmod>` : ''}
    <changefreq>monthly</changefreq>
  </url>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${escapeXml(siteUrl)}</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
${urls}
</urlset>`;
}
