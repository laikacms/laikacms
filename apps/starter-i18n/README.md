# `@laikacms/starter-i18n`

Multilingual content via LaikaCMS's built-in `language` field on documents. Demonstrates
**`Accept-Language` negotiation**, `?lang=` query override, and a per-document fallback chain.

## Stack

- Hono + `@hono/node-server`
- `laikacms` + `@laikacms/decap-integrations/embedded`
- Tiny dependency-free locale negotiator in `src/i18n.ts` (~25 LOC)

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-i18n dev
```

Then:

```bash
# English (default)
curl http://localhost:3000/posts/hello-world
# {"locale":"en", "post":{...title:"Hello in English"...}}

# Dutch via Accept-Language
curl -H "Accept-Language: nl" http://localhost:3000/posts/hello-world
# {"locale":"nl", "post":{...title:"Hallo wereld"...}}

# Explicit override
curl http://localhost:3000/posts/hello-world?lang=nl
```

## Negotiation rules

1. `?lang=…` query param wins if the value is supported.
2. Otherwise, parse the `Accept-Language` header and pick the highest-`q` candidate whose primary
   subtag matches a supported locale.
3. If nothing matches, fall back to `FALLBACK_LOCALE` (default `en`).

When a specific document is missing in the negotiated locale, the single-post handler **falls back
through `SUPPORTED`** in order — so a Dutch reader still gets the English fallback if the Dutch
translation hasn't been written yet.

## Two layout strategies for multilingual content

The starter ships with the **suffix layout** (`hello-world.md`, `hello-world.nl.md`). Trade-offs:

| Strategy                | Keys                                                 | Pros                                              | Cons                                 |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------------- | ------------------------------------ |
| Suffix (this starter)   | `posts/hello-world.{md,nl.md,de.md}`                 | Same slug across languages                        | Filesystem-level fallback needs care |
| Per-locale folder       | `posts/en/hello-world.md`, `posts/nl/hello-world.md` | Cleaner separation, Decap i18n config supports it | Slug paths include locale            |
| Single doc, multi-field | One doc with `title_en`, `title_nl`                  | One source of truth                               | Schema bloat, harder for editors     |

Decap CMS has an [`i18n` config option](https://decapcms.org/docs/i18n/) that handles the per-locale
folder pattern natively. The starter's `src/laika.ts` includes a commented-out block showing how to
enable it.

## Production hardening

- **`Vary: Accept-Language` header.** Add it on every response so CDNs don't serve the wrong cache.
- **Canonical URLs.** Even with content negotiation, expose `/{locale}/posts/{slug}` URLs for SEO
  and shareable links.
- **Translation workflow.** Add a `translationOf` field linking variants — `hello-world.nl.md`'s
  frontmatter could reference `hello-world.md` so editors can see the source.

See [`docs/starters.md`](../../docs/starters.md) and [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
