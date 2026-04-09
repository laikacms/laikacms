# Laika CMS Documentation

Welcome to the Laika CMS documentation. Laika CMS is modular, runtime-agnostic content management
software designed to work with your own custom or existing user interfaces.

## Quick Links

- [Getting Started](./getting-started.md) - Installation and basic usage
- [Architecture](./architecture.md) - How Laika CMS is structured
- [API Reference](./api-reference.md) - Complete API documentation
- [Packages](./packages.md) - Overview of all packages
- [Decap CMS Integration](./decap-integration.md) - Using Decap CMS as a frontend
- [Deployment](./deployment.md) - Production deployment guides
- [Security](./SECURITY.md) - Security best practices
- [Effect Migration](./EFFECT_MIGRATION.md) - Internal migration guide

## What is Laika CMS?

Laika CMS is **composable, modular content management software** designed to work across any
JavaScript runtime—Node.js, Cloudflare Workers, AWS Lambda, Deno, and more. It's API-first, meaning
you bring your own frontend or use existing solutions like Decap CMS.

### Key Principles

1. **Modular by Design** - Pick only the packages you need
2. **Runtime Agnostic** - Works everywhere JavaScript runs
3. **Minimal Dependencies** - Extremely slim bundle sizes
4. **Standard Schema Compatible** - Use Zod, Valibot, or any validation library
5. **Security First** - Quantum-safe cryptography, file sanitization

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        API Layer                             │
│  (storage-api, documents-api, assets-api, contentbase-api)  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Domain Layer                            │
│        (storage, documents, assets, contentbase-settings)   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Implementation Layer                        │
│   (storage-r2, storage-fs, documents-drizzle, assets-r2)    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Shared Layer                             │
│        (core, auth, crypto, sanitizer, i18n, json-api)      │
└─────────────────────────────────────────────────────────────┘
```

## Getting Help

- **GitHub Issues** - For bugs and feature requests
- **GitHub Discussions** - For questions and discussions
- **Contributing** - See [CONTRIBUTING.md](../CONTRIBUTING.md)

## License

Laika CMS is [MIT licensed](../LICENSE).
