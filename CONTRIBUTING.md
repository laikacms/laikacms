# Contributing

**Removing code is more valuable than adding code.**

## Setup

```bash
pnpm install
pnpm build
pnpm test
```

## Guidelines

- Use `workspace:*` for internal dependencies
- Use `catalog:` references for shared dependencies
- Follow [Conventional Commits](https://www.conventionalcommits.org/)
- Run `pnpm lint` and `pnpm format` before committing

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
