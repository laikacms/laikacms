---
title: Hello from Qwik
date: 2026-05-31T10:00:00.000Z
---

This starter uses **Qwik City** — Qwik's full-stack framework. Qwik's distinguishing feature is
**resumability**: instead of shipping JavaScript to "hydrate" the page on first load, Qwik
serializes the application state into the HTML and only loads code lazily, on interaction. The
initial JS payload for this page is tiny.

`routeLoader$` runs on the server during render — it reads the LaikaCMS document repo directly. Same
pattern as the other SSR starters; different runtime story.
