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

## Architecture

```
packages/
├── domain/       # Abstract interfaces (NO implementations)
├── impl/         # Concrete implementations
├── api/          # HTTP API layers (JSON:API)
├── shared/       # Shared utilities
├── serializers/  # Content format serializers
└── decap/        # Decap CMS integrations
```

## Layer Rules

- **Domain** packages MUST NOT depend on implementation packages
- **Implementation** packages depend on domain packages
- **API** packages depend on domain packages (not implementations)
- **Shared** packages are utilities that don't fit a specific category

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
