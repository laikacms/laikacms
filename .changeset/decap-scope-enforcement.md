---
"@laikacms/decap": minor
---

Enforce read-only scope at the API boundary. `User` now carries an optional
`scope: 'read' | 'write'`; when it is explicitly `'read'`, `decapApi` rejects any mutating (non
GET/HEAD/OPTIONS) request with a 403 before it reaches a sub-API, so a read-only credential can no
longer write even though the repositories grant every authenticated principal full read+write.
Backwards compatible: principals with `scope` unset or `'write'` keep full access.
