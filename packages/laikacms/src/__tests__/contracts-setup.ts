/**
 * Vitest setup file that pulls in every repository implementation's
 * `testing.ts`. Each one self-registers a contract case against its domain's
 * registry, so by the time any `contract.test.ts` runs, the registries are
 * already populated.
 *
 * If you add a new impl under `src/impl/<name>/`, add a side-effect import
 * here. External consumers that wire up `laikacms/<domain>/testing` in their
 * own packages don't need this file — they just need to import their own
 * impl's `testing` module before their own contract.test.ts evaluates.
 */

// Storage impls
import '../impl/storage-fs/testing.js';
import '../impl/storage-r2/testing.js';
import '../impl/storage-webdav/testing.js';
import '../impl/storage-jsonapi-proxy/testing.js';
import '../impl/storage-drizzle/testing.js';

// Documents impls
import '../impl/documents-contentbase/testing.js';
import '../impl/documents-obsidian/testing.js';
import '../impl/documents-drizzle/testing.js';
import '../impl/documents-jsonapi-proxy/testing.js';

// Assets impls
import '../impl/assets-contentbase/testing.js';
import '../impl/assets-obsidian/testing.js';
import '../impl/assets-r2/testing.js';
import '../impl/assets-jsonapi-proxy/testing.js';
