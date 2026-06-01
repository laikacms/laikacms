import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { InfluxDbDataSource, InfluxDbStorageRepository } from '@laikacms/influxdb/storage-influxdb';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * INFLUX_URL     — InfluxDB v2 base URL (default: http://localhost:8086).
 * INFLUX_ORG     — Organisation name or ID (required).
 * INFLUX_BUCKET  — Bucket name (default: "cms"). Create with:
 *                    influx bucket create -n cms -o <org> -r 0
 * INFLUX_TOKEN   — All-access or write-scoped operator token (required).
 *                  NOTE: header is `Authorization: Token <token>`, NOT Bearer.
 *
 * Six distinctive InfluxDB / wire-format traits this starter exercises:
 *
 *   1. Line protocol writes — newline-delimited textual writes:
 *        laika_storage,kind=file,parent=posts,name=hello,extension=md content="…" <ns>
 *      First textual line-by-line write format in the Laika suite.
 *
 *   2. Flux pipeline DSL for reads — functional |>-piped expressions:
 *        from(bucket:"cms") |> range(start:0) |> filter(…) |> last()
 *      First functional pipeline DSL in the suite.
 *
 *   3. Annotated CSV responses — reads return CSV with #datatype / #group /
 *      #default annotation rows before the column header. First CSV-on-the-wire
 *      backend in the suite.
 *
 *   4. Tags vs fields distinction — kind/parent/name/extension are indexed
 *      tags; content is an unindexed field.
 *
 *   5. Nanosecond timestamps — writes carry Date.now() * 1_000_000 precision;
 *      surfaces as metadata.revisionId. First nanosecond-precision revisionId
 *      in the suite.
 *
 *   6. Append-only storage — every write creates a new point; |> last()
 *      deduplicates on read. Old versions remain until the retention policy
 *      expires them (set -r 0 for infinite retention in development).
 *
 * Quick start with Docker:
 *   docker run -p 8086:8086 influxdb:2
 *   # open http://localhost:8086, create org + bucket "cms", copy token
 *   INFLUX_ORG=my-org INFLUX_TOKEN=<token> pnpm dev
 */
const dataSource = new InfluxDbDataSource({
  url: process.env['INFLUX_URL'] ?? 'http://localhost:8086',
  org: requireEnv('INFLUX_ORG'),
  bucket: process.env['INFLUX_BUCKET'] ?? 'cms',
  auth: { token: requireEnv('INFLUX_TOKEN') },
});

const storage = new InfluxDbStorageRepository({
  dataSource,
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
