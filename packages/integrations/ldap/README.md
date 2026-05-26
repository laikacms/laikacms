# @laikacms/ldap

LDAP-backed implementations of Laika CMS contracts. First (and current) export:
**`@laikacms/ldap/storage-ldap`** — a `StorageRepository` over an LDAP directory.

**Client-agnostic.** The package depends on a structural `LdapOps` interface (five methods:
`search`, `add`, `modify`, `del`, `bulkOps`). Bring your own client — the official `ldapjs` client,
a DSMLv2/HTTP gateway shim, or anything else that satisfies the shape.

```bash
pnpm add @laikacms/ldap
# bring your own client:
pnpm add ldapjs
```

## Why an LDAP package

LDAP (Lightweight Directory Access Protocol) has five architectural traits not yet covered in the
Laika suite:

**1. Distinguished Name (DN) hierarchical addressing.** Every entry's location is encoded directly
into its identity. A path like `notes/hello.md` becomes a DN like:

```
cn=hello.md,ou=notes,ou=cms,dc=example,dc=com
└── leaf RDN             └── ancestor OUs       └── base DN
```

RDNs are listed _right-to-left_ — leaf first, root last. **First backend in the suite with this
addressing idiom.**

**2. `objectClass` schema model.** Every entry declares its type(s) via a multi-valued `objectClass`
attribute. The repository uses:

```ldif
dn: cn=hello.md,ou=notes,ou=cms,dc=example,dc=com
objectClass: top
objectClass: laikaFile
cn: hello.md
laikaParent: notes
laikaExtension: md
laikaContent: hi

dn: ou=notes,ou=cms,dc=example,dc=com
objectClass: top
objectClass: organizationalUnit
objectClass: laikaFolder
ou: notes
```

**3. LDAP search filter DSL.** Filters are S-expression-ish strings per RFC 4515:
`(&(objectClass=laikaFile)(cn=hello.md))`. The repository builds them; the data source consumes them
verbatim. The most distinctive idiom: extension-free key resolution as a single OR'd filter,
resolving across N candidates in one call:

```
(&(objectClass=laikaFile)(|(cn=hello.md)(cn=hello.json)(cn=hello.txt)))
```

**4. Scope-based searches** (`base`, `one`, `sub`). The repository uses `one`-scope against the
parent OU for listings — server-side filtering to immediate children only, no client-side prefix
scan needed.

**5. `bulkOps` as the atomic-multi-write primitive.** A sequenced array of typed action records:

```ts
ops.bulkOps([
  { kind: 'del', dn: 'cn=a.md,ou=notes,...' },
  { kind: 'del', dn: 'cn=b.md,ou=notes,...' },
  { kind: 'del', dn: 'cn=c.md,ou=notes,...' },
]);
```

Real LDAP doesn't have a native multi-entry transaction — the LDAP Transactions extension (RFC 5805)
exists but is server-dependent. Implementations fall back to sequential per-op execution and return
per-op results. **The 13th structurally distinct atomic-multi-write mechanism in the Laika suite.**

## Usage

```ts
import { LdapDataSource, type LdapOps, LdapStorageRepository } from '@laikacms/ldap/storage-ldap';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { Client as LdapClient } from 'ldapjs';

// Wrap ldapjs (or any client) into the LdapOps shape.
const ops: LdapOps = makeLdapJsAdapter(new LdapClient({ url: 'ldaps://ldap.example.com' }));

const dataSource = new LdapDataSource({ ops });
const repo = new LdapStorageRepository({
  dataSource,
  baseDn: 'ou=cms,dc=example,dc=com',
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

await repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } });
await repo.removeAtoms(['notes/hello']);
```

### Schema setup

The repository assumes (but does not provision) the custom object classes `laikaFile` and
`laikaFolder`. Add them to your LDAP schema:

```ldif
attributetype ( 1.3.6.1.4.1.99999.1.1
  NAME 'laikaParent'
  DESC 'Laika CMS: parent folder path'
  EQUALITY caseExactMatch
  SYNTAX 1.3.6.1.4.1.1466.115.121.1.15
  SINGLE-VALUE )

attributetype ( 1.3.6.1.4.1.99999.1.2
  NAME 'laikaExtension'
  DESC 'Laika CMS: file extension'
  EQUALITY caseExactMatch
  SYNTAX 1.3.6.1.4.1.1466.115.121.1.15
  SINGLE-VALUE )

attributetype ( 1.3.6.1.4.1.99999.1.3
  NAME 'laikaContent'
  DESC 'Laika CMS: serialized content'
  EQUALITY caseExactMatch
  SYNTAX 1.3.6.1.4.1.1466.115.121.1.15
  SINGLE-VALUE )

objectclass ( 1.3.6.1.4.1.99999.2.1
  NAME 'laikaFile' SUP top STRUCTURAL
  MUST ( cn $ laikaParent $ laikaExtension )
  MAY ( laikaContent ) )

objectclass ( 1.3.6.1.4.1.99999.2.2
  NAME 'laikaFolder' SUP top AUXILIARY
  MUST ( ou ) )
```

(Use your own OID prefix; `1.3.6.1.4.1.99999` is a placeholder.)

## Operation mapping

| Laika operation             | LDAP call(s)                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `getObject(key)`            | 1 × `search` (scope=`one`, OR'd cn filter)                                         |
| `createObject(key, …)`      | N × `search` (probe ancestor OUs) + N × `add` (auto-create OUs) + 1 × `add` (file) |
| `updateObject(key, …)`      | 1 × `search` (probe) + 1 × `modify` (`replace` op)                                 |
| `createOrUpdateObject`      | 1 × `search` + 1 × (`add` or `modify`)                                             |
| `createFolder(key)`         | N × `search` + N × `add` (auto-create OUs)                                         |
| `removeAtoms([k₁…kₙ])`      | n × `search` (resolve) + **1 × `bulkOps` with N `del` actions**                    |
| `listAtomSummaries(folder)` | 1 × `search` (scope=`one`, filter=`(objectClass=*)`)                               |
| `getCapabilities()`         | (no I/O — static)                                                                  |

## RFC 4515 filter escaping

Special characters in LDAP filter values are dangerous (LDAP injection via crafted file names). The
data source escapes them per RFC 4515 §3 before building filter strings:

| Char | Escaped form |
| ---- | ------------ |
| `\`  | `\5c`        |
| `*`  | `\2a`        |
| `(`  | `\28`        |
| `)`  | `\29`        |
| `\0` | `\00`        |

So `(cn=a*b)` is wrong (matches wildcard); `(cn=a\2ab)` is correct (matches literal `a*b`). The
repository's `eqFilter()` helper handles this; verified by the "filter escaping protects against
LDAP injection" test.

## Caveats

- **The repository never extends the LDAP schema.** Define `laikaFile`, `laikaFolder`,
  `laikaParent`, `laikaExtension`, `laikaContent` once in your LDAP server's schema. Migrations live
  outside this package.
- **`bulkOps` is per-op atomic, not transactional.** One `del` can succeed while another reports "no
  such object" — same per-op reporting model as CouchDB's `_bulk_docs` (iter 26). The repository
  surfaces per-op failures via `recoverableErrors`.
- **No paged-results control (RFC 2696) yet.** Large folders are fetched in one shot. For folders
  with tens of thousands of entries, add server-side paging at the LdapOps layer.
- **Real LDAP servers vary on `bulkOps`.** Without a true transactions extension, your client likely
  sequences the ops over one connection. That's typically sufficient for the CMS use case; the
  repository doesn't assume atomicity beyond what `LdapOps.bulkOps` guarantees.
