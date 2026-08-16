import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { synchronizeOptionalPeerDependencies } from './cms-extension-dependencies.js';
import { DEFAULT_CMS_ADAPTER, getCmsAdapter } from './cms/registry.js';
import type { CmsSelection } from './cms/types.js';

// Add starters here only after their source has passed the standalone
// install/typecheck/build smoke test. The other curated starters are still
// being migrated to the consolidated LaikaCMS 3.x package layout.
export const STARTERS = ['starter-astro-blog'] as const;
export type StarterName = typeof STARTERS[number];
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface BootstrapOptions {
  starter?: string;
  directory: string;
  name?: string;
  title?: string;
  packageManager?: PackageManager;
  install?: boolean;
  /** Which CMS, and what to register in its generated `src/cms.ts` (default: what the starter's blog collections need). */
  cms?: CmsSelection;
}

export interface BootstrapResult {
  directory: string;
  name: string;
  starter: StarterName;
  cms: CmsSelection;
  installed: boolean;
  /** Dependencies whose build scripts pnpm skipped and nobody approved (only ever non-empty on non-interactive pnpm installs). */
  ignoredBuilds: readonly string[];
}

const exists = async (candidate: string): Promise<boolean> => {
  try {
    await access(candidate, constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

const findLocalStarter = async (starter: StarterName): Promise<string | undefined> => {
  const starts = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))];
  for (const start of starts) {
    let current = path.resolve(start);
    for (;;) {
      const candidate = path.join(current, 'starters', starter);
      if (await exists(path.join(candidate, 'package.json'))) return candidate;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return undefined;
};

interface GitTreeEntry {
  path: string;
  type: 'blob' | 'tree';
  url: string;
}

const downloadStarter = async (starter: StarterName, destination: string): Promise<void> => {
  const prefix = `starters/${starter}/`;
  const response = await fetch(
    'https://api.github.com/repos/laikacms/laikacms/git/trees/develop?recursive=1',
    { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'laikacli' } },
  );
  if (!response.ok) throw new Error(`Could not download ${starter}: GitHub returned ${response.status}`);
  const payload = await response.json() as { tree?: GitTreeEntry[] };
  const files = (payload.tree ?? []).filter(entry => entry.type === 'blob' && entry.path.startsWith(prefix));
  if (files.length === 0) throw new Error(`Could not find ${starter} in the LaikaCMS repository`);
  await Promise.all(files.map(async entry => {
    const relative = entry.path.slice(prefix.length);
    const target = path.join(destination, relative);
    const fileResponse = await fetch(entry.url, {
      headers: { Accept: 'application/vnd.github.raw+json', 'User-Agent': 'laikacli' },
    });
    if (!fileResponse.ok) throw new Error(`Could not download ${entry.path}: GitHub returned ${fileResponse.status}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, new Uint8Array(await fileResponse.arrayBuffer()));
  }));
};

const assertEmptyDestination = async (destination: string): Promise<void> => {
  if (!await exists(destination)) return;
  const entries = await readdir(destination);
  if (entries.length > 0) throw new Error(`Destination is not empty: ${destination}`);
};

const runCommand = (directory: string, command: string, args: readonly string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd: directory, stdio: 'inherit' });
    child.once('error', reject);
    child.once(
      'exit',
      code => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`)),
    );
  });

const installDependencies = (directory: string, packageManager: PackageManager): Promise<void> =>
  runCommand(directory, packageManager, ['install']);

// The extension analyzer reads installed ESM files without evaluating them.
// Yarn's PnP zip archives are intentionally opaque to ordinary filesystem
// reads, so generated Yarn projects use its supported node_modules linker.
const configurePackageManager = async (
  directory: string,
  packageManager: PackageManager,
): Promise<void> => {
  if (packageManager !== 'yarn') return;
  await writeFile(path.join(directory, '.yarnrc.yml'), 'nodeLinker: node-modules\n');
};

// Exit code and stderr are deliberately ignored: an empty or failed capture
// (e.g. a pnpm version without this subcommand) parses to "nothing ignored".
const captureOutput = (directory: string, command: string, args: readonly string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd: directory, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk;
    });
    child.once('error', reject);
    child.once('exit', () => resolve(output));
  });

// `pnpm ignored-builds` prints one indented package name per line under its
// header. Sentinel lines ("None", "Cannot identify as no node_modules found")
// contain spaces or equal "None", and "hint:" lines are flush left, so a
// single indented token other than "None" is always a package name.
export const parseIgnoredBuilds = (output: string): string[] =>
  output.split('\n')
    .map(line => /^[ \t]+(\S+)$/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined && name !== 'None');

// pnpm skips build scripts of unapproved dependencies but still exits 0, so a
// bootstrap would otherwise hand over a silently degraded install. When any
// were skipped, defer to pnpm's own interactive prompt; without a terminal,
// return them so the caller can warn.
const approveIgnoredBuilds = async (directory: string): Promise<readonly string[]> => {
  const ignored = parseIgnoredBuilds(await captureOutput(directory, 'pnpm', ['ignored-builds']));
  if (ignored.length === 0) return [];
  if (!process.stdin.isTTY || !process.stdout.isTTY) return ignored;
  await runCommand(directory, 'pnpm', ['approve-builds']);
  return [];
};

export async function bootstrapApplication(options: BootstrapOptions): Promise<BootstrapResult> {
  const starter = options.starter ?? 'starter-astro-blog';
  if (!STARTERS.includes(starter as StarterName)) {
    throw new Error(`Unknown starter "${starter}". Available starters: ${STARTERS.join(', ')}`);
  }
  const selected = starter as StarterName;
  const destination = path.resolve(options.directory);
  const name = options.name ?? path.basename(destination);
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw new Error(`Invalid package name: ${name}`);
  }
  // Validate the CMS and its selection (both throw on unknown names) before
  // touching the disk.
  const cms = options.cms ?? DEFAULT_CMS_ADAPTER.defaultSelection;
  const adapter = getCmsAdapter(cms.adapter);
  const cmsModule = adapter.generateModule(cms);

  await assertEmptyDestination(destination);
  await mkdir(destination, { recursive: true });
  const local = await findLocalStarter(selected);
  // Skip untracked artifacts a local starter checkout may carry, so the local
  // path yields the same tree as downloadStarter, which only sees git blobs.
  if (local) {
    await cp(local, destination, {
      recursive: true,
      force: false,
      filter: source => !['node_modules', 'dist', '.astro'].includes(path.basename(source)),
    });
  } else await downloadStarter(selected, destination);

  const packagePath = path.join(destination, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>;
  packageJson.name = name;
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

  // Every starter routes its admin registrations through src/cms.ts; the copy
  // in the template is the default selection, so overwrite it with the user's.
  await writeFile(path.join(destination, 'src', 'cms.ts'), cmsModule);

  if (options.title) {
    const layoutPath = path.join(destination, 'src', 'pages', 'index.astro');
    const source = await readFile(layoutPath, 'utf8');
    await writeFile(layoutPath, source.replaceAll('My Blog', options.title));
  }

  const packageManager = options.packageManager ?? 'pnpm';
  const install = options.install ?? true;
  await configurePackageManager(destination, packageManager);
  if (install) {
    await installDependencies(destination, packageManager);
    const addedPeers = await synchronizeOptionalPeerDependencies({
      projectDirectory: destination,
      packageName: adapter.packageName,
      extensionSubpaths: adapter.extensionSubpaths(cms),
    });
    if (addedPeers.length > 0) await installDependencies(destination, packageManager);
  }
  const ignoredBuilds = install && packageManager === 'pnpm'
    ? await approveIgnoredBuilds(destination)
    : [];
  return { directory: destination, name, starter: selected, cms, installed: install, ignoredBuilds };
}
