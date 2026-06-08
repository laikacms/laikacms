# @laikacloud/storybook

Storybook for the Laika CMS workspace's React UI. It renders the components from the packages that
ship a UI, straight from their TypeScript source.

## Running

```bash
# from the repo root
pnpm --filter @laikacloud/storybook storybook      # dev server on http://localhost:6006
pnpm --filter @laikacloud/storybook build-storybook # static build into storybook-static/
pnpm --filter @laikacloud/storybook typecheck       # tsc --noEmit
```

The dev server needs no prior build of the other packages — see "How it resolves packages" below.

## What's covered

| Sidebar section        | Package                                   | Notes                                       |
| ---------------------- | ----------------------------------------- | ------------------------------------------- |
| Lexical Editor / UI    | `decap-cms-widget-lexicaleditor`          | The `editor/ui/*` component library         |
| Decap Integrations     | `@laikacms/decap-integrations`            | Lucide + Radix icon widgets (mocked props)  |
| Portable Text Editor   | `decap-cms-widget-portabletext-editor`    | Live `PortableTextEditorView` + toolbar     |
| Decap AI               | `@laikacms/decap-ai`                       | Chat control shell (mock store + stub fetch)|

`decap-cms-lexical-core` is documented on the Introduction page rather than mounted: it exposes a
Lexical `DecoratorNode` subclass and a React context provider, not a standalone visual component.

## Theme

Use the **Theme** toolbar control to switch every story between the editor's light and dark design
tokens. The tokens come from the Lexical widget's `EditorGlobalStyles` (emotion global styles with
CSS custom properties); the preview decorator injects them and toggles a `.dark` class.

## How it resolves packages

Stories import each package through its real public specifiers (for example
`decap-cms-widget-lexicaleditor/editor/ui/button`). Two different resolutions are wired up:

- **Vite (dev + build-storybook)** aliases those specifiers to each package's `src` (see
  `.storybook/main.ts`), so stories render from source with HMR and without building the packages
  first.
- **TypeScript (`typecheck`)** resolves them to the packages' built `dist` types, so only story code
  is type-checked and the libraries are treated as external dependencies — exactly how a consumer
  uses them. This means `typecheck` requires the dependency packages to be built first (which
  `turbo run typecheck` handles via its `^build` dependency).

## Adding a story

Add `stories/<area>/<Component>.stories.tsx`. Import the component from its package's public
specifier, give the `meta` a `title`, and add `tags: ['autodocs']` for an auto-generated docs page.
Overlay components (dialog, dropdown, popover, select, tooltip, command) also have `play` functions
that drive and assert their open state using `storybook/test`.
