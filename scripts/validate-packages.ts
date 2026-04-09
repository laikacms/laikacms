#!/usr/bin/env npx tsx
/**
 * Package Validation Script for Laika CMS
 *
 * Validates that all packages follow consistent naming conventions and metadata rules.
 *
 * Run with: npx tsx scripts/validate-packages.ts
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

// JSON Schema URL for package.json key order
const PACKAGE_JSON_SCHEMA_URL =
  'https://raw.githubusercontent.com/SchemaStore/schemastore/refs/heads/master/src/schemas/json/package.json';

// ============================================================================
// Configuration (loaded from root package.json)
// ============================================================================

const PACKAGES_DIR = 'packages';

// Author can be a string or an object
interface AuthorObject {
  name: string;
  email?: string;
  url?: string;
}

type Author = string | AuthorObject;

/**
 * Normalizes author to a string format "Name <email>"
 */
function normalizeAuthor(author: Author | undefined): string {
  if (!author) return '';
  if (typeof author === 'string') return author;

  // Object format: { name, email?, url? }
  if (author.email) {
    return `${author.name} <${author.email}>`;
  }
  return author.name;
}

/**
 * Checks if two authors match (handles both string and object formats)
 */
function authorsMatch(pkgAuthor: Author | undefined, rootAuthor: Author | undefined): boolean {
  const normalizedPkg = normalizeAuthor(pkgAuthor);
  const normalizedRoot = normalizeAuthor(rootAuthor);

  if (normalizedPkg === normalizedRoot) return true;

  // Also allow just the name to match
  const rootName = typeof rootAuthor === 'object' ? rootAuthor.name : rootAuthor?.split('<')[0].trim();
  const pkgName = typeof pkgAuthor === 'object' ? pkgAuthor.name : pkgAuthor?.split('<')[0].trim();

  return pkgName === rootName;
}

// These will be loaded from root package.json
let ROOT_CONFIG: {
  author: Author,
  authorString: string, // Normalized string format
  engines: Record<string, string>,
  packageManager: string,
  scope: string,
} = {
  author: '',
  authorString: '',
  engines: {},
  packageManager: '',
  scope: '',
};

async function loadRootConfig(): Promise<void> {
  const rootPackageJsonPath = join(process.cwd(), 'package.json');
  const content = await readFile(rootPackageJsonPath, 'utf-8');
  const rootPkg = JSON.parse(content);

  // Extract scope from the first package name or use default
  const name = rootPkg.name as string;
  const scopeMatch = name.match(/^@([^/]+)\//);

  const author = rootPkg.author || '';

  ROOT_CONFIG = {
    author,
    authorString: normalizeAuthor(author),
    engines: rootPkg.engines || {},
    packageManager: rootPkg.packageManager || '',
    scope: scopeMatch ? `@${scopeMatch[1]}` : '',
  };

  // If root doesn't have a scope, we'll detect it from packages
  if (!ROOT_CONFIG.scope) {
    const packagesDir = join(process.cwd(), PACKAGES_DIR);
    const packages = await findPackages(packagesDir);
    if (packages.length > 0) {
      const firstPkgPath = join(packages[0], 'package.json');
      const firstPkgContent = await readFile(firstPkgPath, 'utf-8');
      const firstPkg = JSON.parse(firstPkgContent);
      const pkgScopeMatch = (firstPkg.name as string).match(/^(@[^/]+)\//);
      if (pkgScopeMatch) {
        ROOT_CONFIG.scope = pkgScopeMatch[1];
      }
    }
  }
}

// ============================================================================
// Types
// ============================================================================

interface PackageJson {
  name: string;
  version?: string;
  description?: string;
  author?: Author;
  license?: string;
  private?: boolean;
  type?: string;
  main?: string;
  types?: string;
  engines?: Record<string, string>;
  packageManager?: string;
  [key: string]: unknown;
}

interface ValidationError {
  package: string;
  path: string;
  rule: string;
  message: string;
  severity: 'error' | 'warning';
}

interface ValidationResult {
  packageName: string;
  packagePath: string;
  errors: ValidationError[];
  warnings: ValidationError[];
}

// Stores the canonical key order from JSON schema
let SCHEMA_KEY_ORDER: string[] = [];

/**
 * Fetches the package.json JSON schema and extracts the key order from properties
 */
async function fetchSchemaKeyOrder(): Promise<string[]> {
  try {
    console.log('📥 Fetching package.json schema from SchemaStore...');
    const response = await fetch(PACKAGE_JSON_SCHEMA_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch schema: ${response.status} ${response.statusText}`);
    }
    const schema = await response.json() as { properties?: Record<string, unknown> };

    if (schema.properties) {
      const keys = Object.keys(schema.properties);
      console.log(`   Found ${keys.length} keys in schema\n`);
      return keys;
    }

    console.log('   Warning: No properties found in schema, using fallback order\n');
    return [];
  } catch (error) {
    console.log(`   Warning: Could not fetch schema (${error}), using fallback order\n`);
    return [];
  }
}

// Valid subdirectories in packages/
const VALID_SUBDIRS = ['domain', 'impl', 'api', 'serializers', 'shared', 'decap', 'tools'] as const;
type ValidSubdir = typeof VALID_SUBDIRS[number];

const DECAP_PATTERNS = {
  widget: /^decap-cms-widget-[a-z][a-z0-9-]*$/,
  locale: /^decap-cms-locale-[a-z]{2}(-[A-Z]{2})?$/,
  editorComponent: /^decap-cms-editor-component-[a-z][a-z0-9-]*$/,
  backend: /^decap-cms-backend-[a-z][a-z0-9-]*$/,
  server: /^decap-server-[a-z][a-z0-9-]*$/,
  oauth2: /^decap-oauth2$/,
  api: /^decap-api$/,
};

// Patterns for determining which subdirectory a package should be in
const SUBDIR_PATTERNS: Record<ValidSubdir, RegExp[]> = {
  // Domain packages - core interfaces and entities
  domain: [
    /^(storage|documents|assets)$/,
    /^contentbase-settings$/,
  ],

  // Infrastructure implementations
  impl: [
    /^(storage|documents|assets)-drizzle$/,
    /^(storage|documents|assets)-jsonapi-proxy$/,
    /^storage-(fs|r2)$/,
    /^documents-contentbase$/,
    /^assets-r2$/,
  ],

  // API servers
  api: [
    /^(storage|documents|assets|contentbase)-api$/,
  ],

  // Serializers
  serializers: [
    /^storage-serializers-(json|yaml|markdown|raw)$/,
  ],

  // Shared utilities
  shared: [
    /^(core|i18n|crypto|auth|sanitizer)$/,
    /^json-api$/,
    /^file-sanitizer$/,
    /^token-crypto$/,
  ],

  // Decap packages (all decap-* packages)
  decap: [
    /^decap-/,
  ],

  // Development tools
  tools: [
    /^dynamodb-local$/,
  ],
};

// ============================================================================
// Validation Functions
// ============================================================================

function validateAuthor(pkg: PackageJson, pkgPath: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const pkgAuthorString = normalizeAuthor(pkg.author);
  const rootAuthorString = ROOT_CONFIG.authorString;

  if (!pkg.author) {
    errors.push({
      package: pkg.name,
      path: pkgPath,
      rule: 'author-required',
      message: `Missing author field. Expected: "${rootAuthorString}"`,
      severity: 'error',
    });
  } else if (!authorsMatch(pkg.author, ROOT_CONFIG.author)) {
    // Check if it's just missing the email
    const rootName = typeof ROOT_CONFIG.author === 'object'
      ? ROOT_CONFIG.author.name
      : ROOT_CONFIG.authorString.split('<')[0].trim();
    const pkgName = typeof pkg.author === 'object'
      ? pkg.author.name
      : pkgAuthorString.split('<')[0].trim();

    if (pkgName === rootName) {
      errors.push({
        package: pkg.name,
        path: pkgPath,
        rule: 'author-format',
        message: `Author should include email. Found: "${pkgAuthorString}", expected: "${rootAuthorString}"`,
        severity: 'warning',
      });
    } else {
      errors.push({
        package: pkg.name,
        path: pkgPath,
        rule: 'author-mismatch',
        message: `Incorrect author. Found: "${pkgAuthorString}", expected: "${rootAuthorString}"`,
        severity: 'error',
      });
    }
  }

  return errors;
}

function validateScope(pkg: PackageJson, pkgPath: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (ROOT_CONFIG.scope && !pkg.name.startsWith(`${ROOT_CONFIG.scope}/`)) {
    errors.push({
      package: pkg.name,
      path: pkgPath,
      rule: 'scope-required',
      message: `Package name must be scoped with "${ROOT_CONFIG.scope}/". Found: "${pkg.name}"`,
      severity: 'error',
    });
  }

  return errors;
}

function validateDecapPackageNaming(
  pkg: PackageJson,
  pkgPath: string,
  folderPath: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const name = pkg.name.replace(`${ROOT_CONFIG.scope}/`, '');

  // Check if this is in packages/decap/ directory
  const isInDecapFolder = folderPath.startsWith('packages/decap/');

  // Skip non-decap packages
  if (!name.startsWith('decap-')) {
    return errors;
  }

  if (isInDecapFolder) {
    // Packages in packages/decap/ should follow any valid decap pattern
    const validPatterns = Object.values(DECAP_PATTERNS);
    const matchesPattern = validPatterns.some(pattern => pattern.test(name));

    if (!matchesPattern) {
      errors.push({
        package: pkg.name,
        path: pkgPath,
        rule: 'decap-folder-naming',
        message:
          `Package in packages/decap/ should follow a valid decap pattern (decap-server-<name>, decap-cms-widget-<name>, decap-cms-locale-<locale>, decap-cms-editor-component-<name>, decap-cms-backend-<name>, decap-oauth2, or decap-api). Found: "${name}"`,
        severity: 'error',
      });
    }

    // Check folder name matches package name
    const folderName = folderPath.split('/').pop();
    if (folderName && folderName !== name) {
      errors.push({
        package: pkg.name,
        path: pkgPath,
        rule: 'decap-folder-name-mismatch',
        message: `Folder name "${folderName}" doesn't match package name "${name}"`,
        severity: 'warning',
      });
    }
  } else {
    // Decap packages should be in packages/decap/
    errors.push({
      package: pkg.name,
      path: pkgPath,
      rule: 'decap-wrong-directory',
      message: `Decap package "${name}" should be in packages/decap/, not "${folderPath}"`,
      severity: 'error',
    });
  }

  return errors;
}

/**
 * Determines which subdirectory a package should be in based on its name
 */
function getExpectedSubdir(name: string): ValidSubdir | null {
  for (const [subdir, patterns] of Object.entries(SUBDIR_PATTERNS)) {
    if (patterns.some(pattern => pattern.test(name))) {
      return subdir as ValidSubdir;
    }
  }
  return null;
}

/**
 * Extracts the subdirectory from a folder path like "packages/domain/storage"
 */
function getActualSubdir(folderPath: string): string | null {
  const match = folderPath.match(/^packages\/([^/]+)\//);
  return match ? match[1] : null;
}

function validateDirectoryPlacement(
  pkg: PackageJson,
  pkgPath: string,
  folderPath: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const name = pkg.name.replace(`${ROOT_CONFIG.scope}/`, '');

  // Get actual and expected subdirectories
  const actualSubdir = getActualSubdir(folderPath);
  const expectedSubdir = getExpectedSubdir(name);

  // Check if package is in a valid subdirectory
  if (!actualSubdir) {
    errors.push({
      package: pkg.name,
      path: pkgPath,
      rule: 'directory-structure',
      message: `Package should be in a subdirectory of packages/ (one of: ${
        VALID_SUBDIRS.join(', ')
      }). Found: "${folderPath}"`,
      severity: 'error',
    });
    return errors;
  }

  // Check if the subdirectory is valid
  if (!VALID_SUBDIRS.includes(actualSubdir as ValidSubdir)) {
    errors.push({
      package: pkg.name,
      path: pkgPath,
      rule: 'invalid-subdirectory',
      message: `Invalid subdirectory "${actualSubdir}". Valid subdirectories are: ${VALID_SUBDIRS.join(', ')}`,
      severity: 'error',
    });
    return errors;
  }

  // Check if package is in the correct subdirectory
  if (expectedSubdir && actualSubdir !== expectedSubdir) {
    errors.push({
      package: pkg.name,
      path: pkgPath,
      rule: 'wrong-subdirectory',
      message: `Package "${name}" should be in packages/${expectedSubdir}/, not packages/${actualSubdir}/`,
      severity: 'error',
    });
  }

  // Validate folder name matches package name
  const folderName = folderPath.split('/').pop();
  if (folderName) {
    // Handle special case: core-lib folder -> @laikacms/core
    const expectedFolderNames = [name, `${name}-lib`];
    if (!expectedFolderNames.includes(folderName)) {
      // Only warn if significantly different
      if (!name.includes(folderName) && !folderName.includes(name)) {
        errors.push({
          package: pkg.name,
          path: pkgPath,
          rule: 'folder-name-mismatch',
          message: `Folder name "${folderName}" doesn't match package name "${name}"`,
          severity: 'warning',
        });
      }
    }
  }

  return errors;
}

function validatePackageStructure(
  pkg: PackageJson,
  pkgPath: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check for required fields
  if (!pkg.version) {
    errors.push({
      package: pkg.name,
      path: pkgPath,
      rule: 'version-required',
      message: 'Missing version field',
      severity: 'error',
    });
  }

  if (!pkg.description) {
    errors.push({
      package: pkg.name,
      path: pkgPath,
      rule: 'description-required',
      message: 'Missing description field',
      severity: 'warning',
    });
  }

  if (!pkg.license) {
    errors.push({
      package: pkg.name,
      path: pkgPath,
      rule: 'license-required',
      message: 'Missing license field. Expected: MIT',
      severity: 'error',
    });
  } else if (pkg.license !== 'MIT') {
    errors.push({
      package: pkg.name,
      path: pkgPath,
      rule: 'license-must-be-mit',
      message: `License must be MIT. Found: "${pkg.license}"`,
      severity: 'error',
    });
  }

  // Check for consistent type: module
  if (pkg.type !== 'module' && pkg.main?.endsWith('.js')) {
    errors.push({
      package: pkg.name,
      path: pkgPath,
      rule: 'esm-type',
      message: 'Consider adding "type": "module" for ESM packages',
      severity: 'warning',
    });
  }

  // Check engines field consistency
  // Only check 'node' engine - pnpm is a workspace-level concern
  const nodeVersion = ROOT_CONFIG.engines?.node;
  if (nodeVersion) {
    if (!pkg.engines) {
      errors.push({
        package: pkg.name,
        path: pkgPath,
        rule: 'engines-required',
        message: `Missing engines field. Expected engines.node: "${nodeVersion}"`,
        severity: 'warning',
      });
    } else if (pkg.engines.node !== nodeVersion) {
      errors.push({
        package: pkg.name,
        path: pkgPath,
        rule: 'engines-node-mismatch',
        message: `Inconsistent engines.node. Found: "${pkg.engines.node || 'undefined'}", expected: "${nodeVersion}"`,
        severity: 'error',
      });
    }
  }

  // Check packageManager field (should NOT be in individual packages, only root)
  if (pkg.packageManager) {
    errors.push({
      package: pkg.name,
      path: pkgPath,
      rule: 'packageManager-in-package',
      message:
        `packageManager field should only be in root package.json, not in individual packages. Found: "${pkg.packageManager}"`,
      severity: 'warning',
    });
  }

  return errors;
}

function validatePackageName(
  pkg: PackageJson,
  pkgPath: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const name = pkg.name.replace(`${ROOT_CONFIG.scope}/`, '');

  // Check for valid npm package name characters
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    errors.push({
      package: pkg.name,
      path: pkgPath,
      rule: 'name-format',
      message: `Package name should be lowercase with hyphens only. Found: "${name}"`,
      severity: 'error',
    });
  }

  // Check for double hyphens
  if (name.includes('--')) {
    errors.push({
      package: pkg.name,
      path: pkgPath,
      rule: 'name-double-hyphen',
      message: `Package name should not contain double hyphens. Found: "${name}"`,
      severity: 'error',
    });
  }

  // Check for trailing/leading hyphens
  if (name.startsWith('-') || name.endsWith('-')) {
    errors.push({
      package: pkg.name,
      path: pkgPath,
      rule: 'name-hyphen-position',
      message: `Package name should not start or end with hyphen. Found: "${name}"`,
      severity: 'error',
    });
  }

  return errors;
}

// ============================================================================
// Key Order Validation
// ============================================================================

/**
 * Checks if a package's key order is consistent with the canonical order.
 * Returns the keys that are out of order.
 */
function getOutOfOrderKeys(packageKeys: string[], canonicalOrder: string[]): string[] {
  const outOfOrder: string[] = [];

  // Filter canonical order to only include keys present in this package
  const expectedOrder = canonicalOrder.filter(k => packageKeys.includes(k));

  // Check if the package keys match the expected order
  let expectedIndex = 0;
  for (const key of packageKeys) {
    if (key === expectedOrder[expectedIndex]) {
      expectedIndex++;
    } else {
      // This key is out of order
      const expectedPosition = expectedOrder.indexOf(key);
      if (expectedPosition > expectedIndex) {
        outOfOrder.push(key);
      }
    }
  }

  return outOfOrder;
}

function validateKeyOrder(
  pkg: PackageJson,
  pkgPath: string,
  packageKeys: string[],
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (SCHEMA_KEY_ORDER.length === 0) {
    return errors; // No schema order available
  }

  const outOfOrderKeys = getOutOfOrderKeys(packageKeys, SCHEMA_KEY_ORDER);

  if (outOfOrderKeys.length > 0) {
    // Find the expected order for this package's keys
    const expectedOrder = SCHEMA_KEY_ORDER.filter((k: string) => packageKeys.includes(k));

    errors.push({
      package: pkg.name,
      path: pkgPath,
      rule: 'key-order',
      message: `Keys out of order: [${outOfOrderKeys.join(', ')}]. Expected order: [${expectedOrder.join(', ')}]`,
      severity: 'warning',
    });
  }

  return errors;
}

// ============================================================================
// Package Discovery
// ============================================================================

async function findPackages(dir: string): Promise<string[]> {
  const packages: string[] = [];

  async function scan(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const fullPath = join(currentDir, entry.name);
      const packageJsonPath = join(fullPath, 'package.json');

      try {
        await stat(packageJsonPath);
        packages.push(fullPath);
      } catch {
        // No package.json, check subdirectories
        await scan(fullPath);
      }
    }
  }

  await scan(dir);
  return packages;
}

// ============================================================================
// Main Validation
// ============================================================================

interface PackageData {
  pkg: PackageJson;
  pkgPath: string;
  relativePath: string;
  keys: string[];
}

async function loadPackageData(pkgPath: string): Promise<PackageData> {
  const packageJsonPath = join(pkgPath, 'package.json');
  const content = await readFile(packageJsonPath, 'utf-8');
  const pkg: PackageJson = JSON.parse(content);
  const relativePath = relative(process.cwd(), pkgPath);
  const keys = Object.keys(pkg);

  return { pkg, pkgPath: packageJsonPath, relativePath, keys };
}

function validatePackage(data: PackageData): ValidationResult {
  const { pkg, pkgPath, relativePath, keys } = data;

  const allErrors: ValidationError[] = [
    ...validateScope(pkg, pkgPath),
    ...validatePackageName(pkg, pkgPath),
    ...validateAuthor(pkg, pkgPath),
    ...validatePackageStructure(pkg, pkgPath),
    ...validateDirectoryPlacement(pkg, pkgPath, relativePath),
    ...validateDecapPackageNaming(pkg, pkgPath, relativePath),
    ...validateKeyOrder(pkg, pkgPath, keys),
  ];

  return {
    packageName: pkg.name,
    packagePath: relativePath,
    errors: allErrors.filter(e => e.severity === 'error'),
    warnings: allErrors.filter(e => e.severity === 'warning'),
  };
}

async function main(): Promise<void> {
  // Load configuration from root package.json
  await loadRootConfig();

  console.log('🔍 Validating packages...\n');
  console.log(`Configuration loaded from root package.json:`);
  console.log(`  Author: ${ROOT_CONFIG.authorString}`);
  console.log(`  Scope: ${ROOT_CONFIG.scope}`);
  console.log(`  Engines: ${JSON.stringify(ROOT_CONFIG.engines)}`);
  console.log(`  Package Manager: ${ROOT_CONFIG.packageManager}\n`);

  // Fetch the JSON schema for key order
  SCHEMA_KEY_ORDER = await fetchSchemaKeyOrder();

  const packagesDir = join(process.cwd(), PACKAGES_DIR);
  const packagePaths = await findPackages(packagesDir);

  console.log(`Found ${packagePaths.length} packages\n`);

  // Load all package data
  const packageDataList: PackageData[] = [];
  for (const pkgPath of packagePaths) {
    const data = await loadPackageData(pkgPath);
    packageDataList.push(data);
  }

  // Validate all packages
  const results: ValidationResult[] = [];
  for (const data of packageDataList) {
    const result = validatePackage(data);
    results.push(result);
  }

  // Print results
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const result of results) {
    if (result.errors.length === 0 && result.warnings.length === 0) {
      console.log(`✅ ${result.packageName}`);
      continue;
    }

    if (result.errors.length > 0) {
      console.log(`❌ ${result.packageName}`);
    } else {
      console.log(`⚠️  ${result.packageName}`);
    }

    for (const error of result.errors) {
      console.log(`   ❌ [${error.rule}] ${error.message}`);
      totalErrors++;
    }

    for (const warning of result.warnings) {
      console.log(`   ⚠️  [${warning.rule}] ${warning.message}`);
      totalWarnings++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Summary');
  console.log('='.repeat(60));
  console.log(`   Packages scanned: ${results.length}`);
  console.log(`   Errors: ${totalErrors}`);
  console.log(`   Warnings: ${totalWarnings}`);

  if (totalErrors > 0) {
    console.log('\n❌ Validation failed with errors');
    process.exit(1);
  } else if (totalWarnings > 0) {
    console.log('\n⚠️  Validation passed with warnings');
    process.exit(0);
  } else {
    console.log('\n✅ All packages valid!');
    process.exit(0);
  }
}

// Parse CLI arguments
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: npx tsx scripts/validate-packages.ts [options]

Options:
  --help, -h    Show this help message

Examples:
  npx tsx scripts/validate-packages.ts
`);
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
