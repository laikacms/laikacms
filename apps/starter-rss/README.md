# `@laikacms/starter-rss`

LaikaCMS posts exposed as **RSS 2.0**, **Atom**, **JSON Feed**, and **sitemap.xml**. Zero
dependencies beyond Hono + LaikaCMS — the four renderers fit in ~150 LOC in `src/feeds.ts`.

## Endpoints

| Path           | Format        | Use case                                         |
| -------------- | ------------- | ------------------------------------------------ |
| `/rss.xml`     | RSS 2.0       | Universal feed reader compatibility              |
| `/atom.xml`    | Atom 1.0      | Modern alternative; better timestamps + IDs      |
| `/feed.json`   | JSON Feed 1.1 | New-school feed format; easier to parse than XML |
| `/sitemap.xml` | Sitemaps 0.9  | Submit to Google Search Console / Bing / Yandex  |

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-rss dev
```

Then:

```bash
curl http://localhost:3000/rss.xml
curl http://localhost:3000/atom.xml
curl http://localhost:3000/feed.json
curl http://localhost:3000/sitemap.xml
```

Set `SITE_URL=https://your-domain.example.com` so the generated `<link>` and `<loc>` elements have
the right canonical URLs.

## Feed auto-discovery

Add these to your site's `<head>` so RSS readers (and search engines) find the feeds without the
user knowing the URL:

```html
<link rel="alternate" type="application/rss+xml"  title="RSS"        href="/rss.xml" />
<link rel="alternate" type="application/atom+xml" title="Atom"       href="/atom.xml" />
<link rel="alternate" type="application/feed+json" title="JSON Feed" href="/feed.json" />
```

## How `src/feeds.ts` works

Four small renderers, all taking a `FeedPost[]` + `FeedMeta`:

```ts
renderRss2(posts, meta)   → string (RSS 2.0 XML)
renderAtom(posts, meta)   → string (Atom 1.0 XML)
renderJsonFeed(posts, meta) → object (JSON Feed 1.1)
renderSitemap(posts, siteUrl) → string (Sitemaps 0.9 XML)
```

XML escape + RFC822 / ISO8601 date formatting handled inline. For richer needs (categories,
enclosures for podcasts, paginated feeds for large archives) reach for the `feed` npm package.

## Production hardening

- **Cache feeds** behind a CDN with a short TTL (10–60s). Reading 100 posts to render a feed is
  cheap, but multiplied by 1000s of feed readers it adds up.
- **`Vary: Accept-Language`** if you also serve multilingual feeds (see `starter-i18n` for the
  pattern).
- **Conditional GET.** Honor `If-Modified-Since` so polite feed readers skip the body when nothing
  changed.

See [`docs/starters.md`](../../docs/starters.md) and [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
