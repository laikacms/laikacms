# The `@laikacms/decap-cms` Fork

The admin UI itself is a maintained fork of [Decap CMS](https://decapcms.org/), published as
[`@laikacms/decap-cms`](https://www.npmjs.com/package/@laikacms/decap-cms). It is a single-package
build of the former `decap-cms-*` monorepo: every former package is exposed as a subpath export, and
the root export is the classic app bootstrap.

The fork has been rebuilt from the ground up and little of the original implementation remains. It
uses the same layered approach as Laika CMS: an agnostic core with opinionated outer layers. The
Decap CMS core remains, while its opinionated parts have been extracted into separate packages. That
separation is deliberate. The fork should not work only with Laika CMS; it remains completely usable
as a standalone CMS without any Laika packages.

Maintaining that standalone path is also a thank-you to the Decap CMS maintainers for creating a CMS
that was already mostly backend-agnostic and headless. The fork continues that work rather than
turning Decap CMS into a private frontend for Laika CMS.

The fork is developed in its own repository and keeps its own documentation there. Rather than
mirror that content here (and let it drift out of date), this page links straight to the live docs
on GitHub — they always reflect the version you get from npm.

## Fork documentation

- **[Overview & what's different from upstream](https://github.com/laikacms/decap-cms#readme)** —
  the single-package layout, subpath exports, and how it relates to Decap CMS v4.
- **[Skills index](https://github.com/laikacms/decap-cms/blob/main/skills/README.md)** — the
  authored guides for working against the fork.
  - [Driving the decap-api](https://github.com/laikacms/decap-cms/blob/main/skills/decap-api-driving/SKILL.md)
  - [Portable Text widget](https://github.com/laikacms/decap-cms/blob/main/skills/decap-portable-text/SKILL.md)
  - [Custom widget development](https://github.com/laikacms/decap-cms/blob/main/skills/decap-widget-development/SKILL.md)
- **[Content Security Policy notes](https://github.com/laikacms/decap-cms/blob/main/docs/security/content-security-policy.md)**
  — serving the admin bundle under a strict CSP.
- **[Contributing](https://github.com/laikacms/decap-cms/blob/main/CONTRIBUTING.md)** — building and
  contributing to the fork.
- **[Changelog](https://github.com/laikacms/decap-cms/blob/main/CHANGELOG.md)** — release history.

::: tip Backend vs. admin This page covers the **admin UI** fork. For wiring the LaikaCMS-compatible
**backend** (storage, API, OAuth2) that the admin talks to, see the rest of this [Decap CMS](./)
section. :::
