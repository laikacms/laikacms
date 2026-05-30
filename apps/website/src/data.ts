/* Laika CMS — REAL backend catalogue + interactive code-swap data.
   Grounded in github.com/laikacms/laikacms — first-party subpath exports
   plus the @laikacms/* integration packages (40+ storage repositories,
   each a real StorageRepository implementation with a built dist/ + tests). */

export const REPO = 'https://github.com/laikacms/laikacms';
export const DOCS = 'https://github.com/laikacms/laikacms/blob/develop/docs';

export const LAIKA_BACKEND_COUNT = '40+';

export type GenericSvgKey = 'folder' | 'braces' | 'yaml' | 'file';
export type BackendIconSpec = { si: string } | { svg: GenericSvgKey };

export interface BackendItem {
  name: string;
  sub: string;
  icon: BackendIconSpec;
}

export interface BackendGroup {
  id: string;
  label: string;
  via?: string;
  note: string;
  items: BackendItem[];
}

export const LAIKA_GROUPS: BackendGroup[] = [
  {
    id: 'native',
    label: 'First-party',
    note: 'Shipped in the box, no extra package — the repositories the core is built around.',
    items: [
      { name: 'Filesystem', sub: 'laikacms/storage-fs', icon: { svg: 'folder' } },
      { name: 'Cloudflare R2', sub: 'laikacms/storage-r2', icon: { si: 'cloudflare' } },
      { name: 'WebDAV', sub: 'laikacms/storage-webdav', icon: { svg: 'folder' } },
      { name: 'JSON:API proxy', sub: 'laikacms/storage-jsonapi-proxy', icon: { svg: 'braces' } },
      { name: 'Drizzle (SQL)', sub: 'laikacms/storage-drizzle', icon: { si: 'drizzle' } },
    ],
  },
  {
    id: 'sql',
    label: 'SQL databases',
    via: 'one adapter · laikacms/storage-drizzle',
    note:
      'A single Drizzle-backed repository reaches every SQL dialect Drizzle speaks — eight engines, one line of config.',
    items: [
      { name: 'PostgreSQL', sub: 'pg · postgres.js', icon: { si: 'postgresql' } },
      { name: 'MySQL', sub: 'mysql2', icon: { si: 'mysql' } },
      { name: 'SQLite', sub: 'better-sqlite3 · bun', icon: { si: 'sqlite' } },
      { name: 'Turso / libSQL', sub: '@libsql/client', icon: { si: 'turso' } },
      { name: 'Cloudflare D1', sub: 'drizzle-orm/d1', icon: { si: 'cloudflare' } },
      { name: 'Supabase', sub: 'postgres-js', icon: { si: 'supabase' } },
      { name: 'PlanetScale', sub: 'drizzle-orm/planetscale', icon: { si: 'planetscale' } },
      { name: 'Neon', sub: '@neondatabase/serverless', icon: { si: 'neon' } },
    ],
  },
  {
    id: 'object',
    label: 'Object stores',
    note: 'Buckets and blob storage — content lives as objects, served at the edge or the origin.',
    items: [
      { name: 'AWS S3', sub: '@laikacms/aws', icon: { si: 'amazonwebservices' } },
      { name: 'Azure Blob', sub: '@laikacms/azure', icon: { si: 'microsoftazure' } },
      { name: 'Backblaze B2', sub: '@laikacms/backblaze', icon: { si: 'backblaze' } },
      { name: 'Vercel Blob', sub: '@laikacms/vercel', icon: { si: 'vercel' } },
    ],
  },
  {
    id: 'nosql',
    label: 'NoSQL & multi-model',
    note: 'Document, columnar and multi-model databases, each with a first-class repository.',
    items: [
      { name: 'MongoDB', sub: '@laikacms/mongodb', icon: { si: 'mongodb' } },
      { name: 'CouchDB', sub: '@laikacms/couchdb', icon: { si: 'apachecouchdb' } },
      { name: 'Firestore', sub: '@laikacms/firestore', icon: { si: 'firebase' } },
      { name: 'Convex', sub: '@laikacms/convex', icon: { si: 'convex' } },
      { name: 'SurrealDB', sub: '@laikacms/surrealdb', icon: { si: 'surrealdb' } },
      { name: 'ArangoDB', sub: '@laikacms/arangodb', icon: { si: 'arangodb' } },
      { name: 'Gel', sub: '@laikacms/gel', icon: { svg: 'braces' } },
      { name: 'ClickHouse', sub: '@laikacms/clickhouse', icon: { si: 'clickhouse' } },
    ],
  },
  {
    id: 'kvgraph',
    label: 'Key-value, graph & search',
    note: "Edges, keys and indexes — Laika's repository contract doesn't care what shape your store is.",
    items: [
      { name: 'Neo4j', sub: '@laikacms/neo4j', icon: { si: 'neo4j' } },
      { name: 'etcd', sub: '@laikacms/etcd', icon: { si: 'etcd' } },
      { name: 'Upstash', sub: '@laikacms/upstash', icon: { si: 'upstash' } },
      { name: 'Algolia', sub: '@laikacms/algolia', icon: { si: 'algolia' } },
      { name: 'MeiliSearch', sub: '@laikacms/meilisearch', icon: { si: 'meilisearch' } },
      { name: 'InfluxDB', sub: '@laikacms/influxdb', icon: { si: 'influxdb' } },
    ],
  },
  {
    id: 'git',
    label: 'Git platforms',
    note: 'Treat a repository as your content store — every save is a commit, every change a diff.',
    items: [
      { name: 'GitHub', sub: '@laikacms/github', icon: { si: 'github' } },
      { name: 'GitLab', sub: '@laikacms/gitlab', icon: { si: 'gitlab' } },
      { name: 'Bitbucket', sub: '@laikacms/bitbucket', icon: { si: 'bitbucket' } },
      { name: 'Gist', sub: '@laikacms/gist', icon: { si: 'github' } },
    ],
  },
  {
    id: 'headless',
    label: 'Headless CMSes',
    note: 'Already invested in another CMS? Point Laika at it and keep one content API in front.',
    items: [
      { name: 'Contentful', sub: '@laikacms/contentful', icon: { si: 'contentful' } },
      { name: 'Sanity', sub: '@laikacms/sanity', icon: { si: 'sanity' } },
      { name: 'Hygraph', sub: '@laikacms/hygraph', icon: { si: 'hygraph' } },
      { name: 'PocketBase', sub: '@laikacms/pocketbase', icon: { si: 'pocketbase' } },
      { name: 'Airtable', sub: '@laikacms/airtable', icon: { si: 'airtable' } },
    ],
  },
  {
    id: 'collab',
    label: 'Collaboration tools',
    note: 'Where teams already write — read and write content straight from the tools they live in.',
    items: [
      { name: 'Notion', sub: '@laikacms/notion', icon: { si: 'notion' } },
      { name: 'Dropbox', sub: '@laikacms/dropbox', icon: { si: 'dropbox' } },
      { name: 'Google Drive', sub: '@laikacms/google', icon: { si: 'googledrive' } },
      { name: 'OneDrive', sub: '@laikacms/microsoft', icon: { si: 'microsoftonedrive' } },
      { name: 'Trello', sub: '@laikacms/trello', icon: { si: 'trello' } },
    ],
  },
  {
    id: 'decentralized',
    label: 'Decentralized & directories',
    note: 'Content-addressed networks, the social web, and even LDAP — the contract is the contract.',
    items: [
      { name: 'IPFS / Pinata', sub: '@laikacms/pinata', icon: { si: 'ipfs' } },
      { name: 'Solid', sub: '@laikacms/solid', icon: { si: 'solid' } },
      { name: 'AT Protocol', sub: '@laikacms/atproto', icon: { si: 'bluesky' } },
      { name: 'LDAP', sub: '@laikacms/ldap', icon: { svg: 'folder' } },
    ],
  },
];

export const LAIKA_ASSETS: { note: string, items: BackendItem[] } = {
  note:
    'Two contracts, same shape. Pair a content store with an asset store — bytes, transforms and URLs — on the backend you already use.',
  items: [
    { name: 'Cloudinary', sub: '@laikacms/cloudinary', icon: { si: 'cloudinary' } },
    { name: 'Cloudflare Images', sub: '@laikacms/cloudflare', icon: { si: 'cloudflare' } },
    { name: 'S3 assets', sub: '@laikacms/aws', icon: { si: 'amazonwebservices' } },
    { name: 'R2 assets', sub: 'laikacms/storage-r2', icon: { si: 'cloudflare' } },
    { name: 'Obsidian vault', sub: '@laikacms/obsidian', icon: { si: 'obsidian' } },
  ],
};

export const LAIKA_SERIALIZERS: BackendItem[] = [
  { name: 'JSON', sub: 'storage-serializers-json', icon: { svg: 'braces' } },
  { name: 'YAML', sub: 'storage-serializers-yaml', icon: { svg: 'yaml' } },
  { name: 'Markdown', sub: 'storage-serializers-markdown', icon: { si: 'markdown' } },
  { name: 'Raw', sub: 'storage-serializers-raw', icon: { svg: 'file' } },
];

export interface SwapItem {
  id: string;
  label: string;
  cls: string;
  path: string;
  ctor: string;
}

export const LAIKA_SWAP: SwapItem[] = [
  {
    id: 'fs',
    label: 'Filesystem',
    cls: 'FileSystemStorageRepository',
    path: 'laikacms/storage-fs',
    ctor: 'new FileSystemStorageRepository({ basePath: "./content" })',
  },
  {
    id: 'r2',
    label: 'Cloudflare R2',
    cls: 'R2StorageRepository',
    path: 'laikacms/storage-r2',
    ctor: 'new R2StorageRepository({ bucket: env.CONTENT_BUCKET })',
  },
  {
    id: 'gh',
    label: 'GitHub',
    cls: 'GitHubStorageRepository',
    path: '@laikacms/github/storage-gh',
    ctor: 'new GitHubStorageRepository({ app, repo: "acme/content" })',
  },
  {
    id: 'sql',
    label: 'SQL (Drizzle)',
    cls: 'DrizzleStorageRepository',
    path: 'laikacms/storage-drizzle',
    ctor: 'new DrizzleStorageRepository({ db })',
  },
  {
    id: 'notion',
    label: 'Notion',
    cls: 'NotionStorageRepository',
    path: '@laikacms/notion',
    ctor: 'new NotionStorageRepository({ token, databaseId })',
  },
  {
    id: 'neo4j',
    label: 'Neo4j',
    cls: 'Neo4jStorageRepository',
    path: '@laikacms/neo4j',
    ctor: 'new Neo4jStorageRepository({ driver })',
  },
  {
    id: 'ipfs',
    label: 'IPFS',
    cls: 'PinataStorageRepository',
    path: '@laikacms/pinata',
    ctor: 'new PinataStorageRepository({ jwt: env.PINATA_JWT })',
  },
];

export const LAIKA_RUNTIMES = ['Node', 'Bun', 'Deno', 'Cloudflare Workers', 'Browser'];
