import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import {
  type LdapBulkOp,
  type LdapBulkResult,
  LdapDataSource,
  type LdapEntry,
  type LdapModifyChange,
  type LdapOps,
  type LdapSearchOptions,
  LdapStorageRepository,
} from '@laikacms/ldap/storage-ldap';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import ldap from 'ldapjs';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * LDAP_URL           — LDAP server URL (default: ldap://localhost:389).
 *                      Use ldaps://host:636 for TLS.
 * LDAP_BIND_DN       — Bind DN for authentication (required).
 *                      Example: cn=admin,dc=example,dc=com
 * LDAP_BIND_PASSWORD — Bind password (required).
 * LDAP_BASE_DN       — Base DN for CMS entries (required).
 *                      Example: ou=cms,dc=example,dc=com
 *                      All Laika entries are created below this DN.
 *
 * Five distinctive LDAP traits this starter exercises:
 *
 *   1. DN hierarchical addressing — path `posts/hello.md` becomes
 *      `cn=hello.md,ou=posts,ou=cms,dc=example,dc=com`. RDNs are
 *      comma-separated right-to-left (leaf first). First backend in
 *      the suite with this addressing idiom.
 *
 *   2. objectClass schema model — every entry declares `laikaFile` or
 *      `laikaFolder` objectClass. You must define these in your LDAP
 *      schema before use (see README for LDIF schema definition).
 *
 *   3. RFC 4515 filter DSL — S-expression-ish filter strings:
 *        (&(objectClass=laikaFile)(|(cn=hello.md)(cn=hello.json)))
 *      The repository builds them; eqFilter() escapes special chars
 *      per §3 to prevent LDAP injection.
 *
 *   4. Scope-based searches — `one` scope for immediate children,
 *      `sub` for subtrees, `base` for the entry itself. First backend
 *      in the suite with a built-in scope vs prefix distinction.
 *
 *   5. bulkOps as the atomic multi-write primitive — sequenced
 *      `{ kind: 'add' | 'modify' | 'del' }` array. Per-op atomicity
 *      (real LDAP transactions via RFC 5805 are server-dependent).
 *
 * Quick start with OpenLDAP via Docker:
 *   docker run -p 389:389 \
 *     -e LDAP_ADMIN_PASSWORD=admin \
 *     -e LDAP_ORGANISATION="Example" \
 *     -e LDAP_DOMAIN="example.com" \
 *     osixia/openldap:latest
 *
 *   Then add the Laika schema (see schema setup in the LDAP README):
 *     ldapadd -x -H ldap://localhost -D "cn=admin,dc=example,dc=com" \
 *       -w admin -f laika-schema.ldif
 *     ldapadd -x -H ldap://localhost -D "cn=admin,dc=example,dc=com" \
 *       -w admin -f base-dn.ldif  # creates ou=cms,dc=example,dc=com
 *
 *   LDAP_URL=ldap://localhost \
 *   LDAP_BIND_DN="cn=admin,dc=example,dc=com" \
 *   LDAP_BIND_PASSWORD=admin \
 *   LDAP_BASE_DN="ou=cms,dc=example,dc=com" \
 *   pnpm dev
 *
 * NOTE: @laikacms/ldap is client-agnostic — it depends on an LdapOps
 * interface rather than any specific library. The adapter below wraps
 * ldapjs v3 but you can swap it for any client that satisfies LdapOps.
 */

function makeLdapJsOps(client: ldap.Client): LdapOps {
  const normalizeError = (err: unknown): never => {
    if (err instanceof Error) {
      const code = (err as { code?: number }).code;
      if (code === 32) {
        const e = new Error(err.message);
        e.name = 'LdapNoSuchObject';
        throw e;
      }
      if (code === 68) {
        const e = new Error(err.message);
        e.name = 'LdapEntryAlreadyExists';
        throw e;
      }
      if (code === undefined || code < 0) {
        const e = new Error(err.message);
        e.name = 'LdapConnectionFailed';
        throw e;
      }
    }
    throw err;
  };

  return {
    search({ base, scope, filter, attributes, sizeLimit }: LdapSearchOptions): Promise<LdapEntry[]> {
      return new Promise((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client.search(base, { scope, filter, attributes, sizeLimit } as any, (err, res) => {
          if (err) {
            try {
              normalizeError(err);
            } catch (ne) {
              reject(ne);
            }
            return;
          }
          const entries: LdapEntry[] = [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          res.on('searchEntry', (entry: any) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const attrs: Record<string, string | string[]> = {};
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const a of entry.attributes as any[]) {
              const vals: string[] = a.vals ?? a.values ?? [];
              attrs[a.type as string] = vals.length === 1 ? vals[0]! : vals;
            }
            entries.push({ dn: String(entry.dn), attributes: attrs });
          });
          res.on('error', (e: Error) => {
            try {
              normalizeError(e);
            } catch (ne) {
              reject(ne);
            }
          });
          res.on('end', () => resolve(entries));
        });
      });
    },

    add(dn: string, attributes: Record<string, string | string[]>): Promise<void> {
      return new Promise((resolve, reject) => {
        client.add(dn, attributes as ldap.Attribute, err => {
          if (err) {
            try {
              normalizeError(err);
            } catch (ne) {
              reject(ne);
              return;
            }
          }
          resolve();
        });
      });
    },

    modify(dn: string, changes: ReadonlyArray<LdapModifyChange>): Promise<void> {
      const ldapChanges = changes.map(
        c =>
          new ldap.Change({
            operation: c.operation,
            modification: new ldap.Attribute({
              type: c.modification.type,
              values: c.modification.values as string[],
            }),
          }),
      );
      return new Promise((resolve, reject) => {
        client.modify(dn, ldapChanges, err => {
          if (err) {
            try {
              normalizeError(err);
            } catch (ne) {
              reject(ne);
              return;
            }
          }
          resolve();
        });
      });
    },

    del(dn: string): Promise<void> {
      return new Promise((resolve, reject) => {
        client.del(dn, err => {
          if (err) {
            try {
              normalizeError(err);
            } catch (ne) {
              reject(ne);
              return;
            }
          }
          resolve();
        });
      });
    },

    async bulkOps(operations: ReadonlyArray<LdapBulkOp>): Promise<LdapBulkResult[]> {
      const results: LdapBulkResult[] = [];
      for (const op of operations) {
        try {
          if (op.kind === 'add') {
            await this.add(op.dn, op.attributes);
          } else if (op.kind === 'modify') {
            await this.modify(op.dn, op.changes);
          } else {
            await this.del(op.dn);
          }
          results.push({ status: 'OK' });
        } catch (err) {
          results.push({ status: 'ERR', message: err instanceof Error ? err.message : String(err) });
        }
      }
      return results;
    },
  };
}

const ldapClient = ldap.createClient({
  url: process.env['LDAP_URL'] ?? 'ldap://localhost:389',
});

await new Promise<void>((resolve, reject) => {
  ldapClient.bind(requireEnv('LDAP_BIND_DN'), requireEnv('LDAP_BIND_PASSWORD'), err => {
    if (err) reject(err);
    else resolve();
  });
});

const dataSource = new LdapDataSource({ ops: makeLdapJsOps(ldapClient) });

const storage = new LdapStorageRepository({
  dataSource,
  baseDn: requireEnv('LDAP_BASE_DN'),
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

export const decapConfig = minimalBlogConfig();

export const laika = createCustomLaika({
  storage,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

export { decapAdminHtml };
