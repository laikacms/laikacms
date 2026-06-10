import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { LibSqlDataSource, LibSqlStorageRepository } from '@laikacms/libsql/storage-libsql';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

/**
 * Doc gap: Deno uses Deno.env.get() for environment variables.
 * process.env also works in Deno 2 via Node.js compat, but Deno.env.get()
 * is idiomatic and requires --allow-env permission explicitly.
 */
function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * @laikacms/libsql uses @libsql/client which communicates with Turso via HTTP.
 * HTTP transport works on Deno via its npm compatibility layer (nodeModulesDir: "auto").
 *
 * Doc gap: LibSqlStorageRepository is Deno-compatible when using HTTP transport
 * (cloud Turso URL or local sqld at http://localhost:8080). No --allow-read or
 * --allow-write permissions needed — only --allow-net and --allow-env.
 */
const dataSource = new LibSqlDataSource({
  url: requireEnv('LIBSQL_URL'),
  auth: { token: Deno.env.get('LIBSQL_AUTH_TOKEN') },
});

const storage = new LibSqlStorageRepository({
  dataSource,
  tableName: Deno.env.get('LIBSQL_TABLE') ?? 'laika_storage',
  serializerRegistry: {
    md: markdownSerializer,
    yaml: yamlSerializer,
    yml: yamlSerializer,
    json: jsonSerializer,
    raw: rawSerializer,
  },
  defaultFileExtension: 'md',
});

const decapConfig = minimalBlogConfig();

export const laika = createCustomLaika({
  storage,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

export const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'Admin · Deno + Turso Blog' });
