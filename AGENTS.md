# AI Agents Guide

Laika CMS is **modular, runtime-agnostic content management software**. API-first, works with any
JavaScript runtime.

## Principles

1. **Modularity** - Each package has a single responsibility
2. **Runtime Agnostic** - Avoid Node.js-specific APIs in core packages
3. **Minimal Dependencies** - Keep bundle sizes small and reduce the likelihood of rogue packages

## Documentation

Docs are in `docs/` folder (no separate website). Use relative links:

- To other docs: `[Architecture](./architecture.md)`
- To packages: `[storage](../packages/domain/storage)`

## Code Style

- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Functions: `camelCase`
- Use `workspace:*` for internal dependencies
- Use `catalog:` for shared dependencies

## Do NOT

- Add Node.js-specific APIs to domain packages
- Avoid exposing Effect types in public APIs
- Add heavy dependencies without discussion

## Recoverable warnings & delegation: `runValueForwarding`

`LaikaTask` and `LaikaStream` both carry recoverable warnings (and progress events) as first-class
metadata alongside the resolved value or stream data. Backends emit warnings via
`emit.recoverableError(err)` when something partially failed but the operation still produced a
usable result (e.g. an R2 readback fell back to a synthesised resource, a corrupt row was skipped,
an unreadable subfolder was passed over).

When you write a higher-level repository that delegates to a lower-level one (e.g. a
`documents-contentbase` method calling `this.storageRepository.createObject(...)`), use the
**forwarding** drainers — not the discarding ones:

```ts
// ✅ Forward inner warnings into the outer task's emit
return LaikaTask.make<Document>(emit =>
  Effect.gen({ self: this }, function*() {
    const obj = yield* LaikaTask.runValueForwarding(
      this.storageRepository.createObject({ ... }),
      emit,
    );
    return this.toDocument(create.key, obj);
  })
);

// ❌ Drops inner warnings — they die at the delegation boundary
const obj = yield* LaikaTask.runValue(this.storageRepository.createObject({ ... }));
```

Same rule for streams: `LaikaStream.runCollectForwarding(stream, emit)` instead of
`LaikaStream.runCollect(stream)`.

`runValue` / `runCollect` are still correct for top-level boundary code (an API server draining a
task into a Promise, test setup, etc.) — they're only a footgun inside a `make` body that's part of
a delegation chain.
