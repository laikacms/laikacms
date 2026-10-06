/**
 * Adapter logos, read from the repo-root `adapters.yaml` — the same list the docs' Adapters section
 * is compiled from — so a backend Laika ships an adapter for shows one logo everywhere.
 *
 * Server-only (it reads the filesystem): import it from components that are rendered at build
 * time, never from an island.
 */
import { load } from 'js-yaml';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Astro runs from apps/website in both `dev` and `build`.
const repoRoot = resolve(process.cwd(), '../..');

const adapters = load(readFileSync(resolve(repoRoot, 'adapters.yaml'), 'utf8')) as {
  key: string,
  icon: string,
  iconDark?: string,
}[];

const dataUri = (path: string) =>
  `data:image/svg+xml;base64,${Buffer.from(readFileSync(resolve(repoRoot, path))).toString('base64')}`;

const iconSrc = new Map(
  adapters.map(a => [a.key, { light: dataUri(a.icon), dark: dataUri(a.iconDark ?? a.icon) }]),
);

/**
 * The logos of the adapter with this key, as data URIs: `light` for light mode and `dark` for dark
 * mode (the same image unless adapters.yaml sets `iconDark`). Throws on an unknown key.
 */
export function adapterIconSrc(key: string): { light: string, dark: string } {
  const src = iconSrc.get(key);
  if (!src) throw new Error(`No adapter "${key}" in adapters.yaml (known: ${[...iconSrc.keys()].join(', ')})`);
  return src;
}
