/**
 * Render scripts/og-card.html to public/assets/og-image.png (1200×630).
 *
 * Uses the locally installed Google Chrome in headless mode so the card picks up
 * the real brand web fonts (Archivo / IBM Plex). No npm dependency — keeps the
 * website's install lean. Run from the app root:
 *
 *   node scripts/generate-og-image.mjs
 *
 * Edit scripts/og-card.html to change the card, then re-run.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const card = resolve(here, 'og-card.html');
const out = resolve(here, '../public/assets/og-image.png');

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

const chrome = CHROME_CANDIDATES.find(existsSync);
if (!chrome) {
  console.error('No Chrome/Chromium binary found. Checked:\n  ' + CHROME_CANDIDATES.join('\n  '));
  process.exit(1);
}

execFileSync(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=2', // 2× for crisp text → 2400×1260 PNG
  '--default-background-color=00000000',
  '--allow-file-access-from-files',
  '--virtual-time-budget=4000', // give web fonts time to load before capture
  '--window-size=1200,630',
  `--screenshot=${out}`,
  `file://${card}`,
], { stdio: 'inherit' });

console.log(`Wrote ${out}`);
