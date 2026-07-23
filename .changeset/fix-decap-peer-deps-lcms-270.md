---
"@laikacms/decap": patch
---

Remove stale client-side peer dependencies (`react`, `react-dom`, `react-redux`, `@emotion/react`,
`@radix-ui/react-icons`, `lucide-react`) that were left over after the client-side Decap integration
code was extracted from this package. These conflicting peers caused an npm ERESOLVE when installing
`decap-cms-app` alongside `@laikacms/decap` because `react-redux@^7.2.0` and `react@^19.2.4` cannot
be co-satisfied (LCMS-270).
