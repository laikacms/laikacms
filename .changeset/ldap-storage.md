---
"@laikacms/ldap": minor
---

New package: `@laikacms/ldap`. First export `@laikacms/ldap/storage-ldap` — a `StorageRepository`
backed by an LDAP directory. **Client-agnostic** — depends on a structural `LdapOps` interface (five
methods: `search`, `add`, `modify`, `del`, `bulkOps`) rather than any specific LDAP library, so it
works with `ldapjs`, DSMLv2/HTTP gateways, or hand-rolled mocks. Five architectural traits
distinguish it from prior backends: (1) **DN-based hierarchical addressing** — right-to-left RDN
order (`cn=hello.md,ou=notes,ou=cms,dc=…`); first backend with this idiom; (2) **`objectClass`
schema model** — entries declare their type(s) via the multi-valued `objectClass` attribute
(`laikaFile` / `laikaFolder` on top of `top` + `organizationalUnit`); (3) **LDAP search filter DSL**
— `(&(objectClass=laikaFile)(|(cn=k.md)(cn=k.json)…))` for extension-free key resolution in **one**
search call; filter values are escaped per RFC 4515 to prevent injection; (4) **scope-based
searches** — `one`-scope against the parent OU gives server-side immediate-child listings; (5)
**`bulkOps` as the atomic-multi-write primitive** — `removeAtoms(N)` ships as one bulkOps call with
N `del` actions. The 13th structurally distinct atomic-multi-write mechanism in the suite. Ancestor
OUs are auto-created when needed (LDAP requires parent entries to exist).
