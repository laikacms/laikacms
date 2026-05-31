---
title: Hello from Deno
date: 2026-05-31T10:00:00.000Z
---

This starter runs `createEmbeddedLaika` on the **Deno 2 runtime** using `Deno.serve()`. The bridge
to LaikaCMS goes through Deno's `nodeModulesDir` mode — `deno.json` declares
`"nodeModulesDir": "auto"`, so Deno resolves `npm:` specifiers from the local `node_modules`
populated by `pnpm install`.

That's important here because the workspace packages aren't published — they live as pnpm symlinks
under `node_modules/`. Deno reads those symlinks the same way Node does, so
`import { createEmbeddedLaika } from
'@laikacms/decap-integrations/embedded'` resolves at runtime.
