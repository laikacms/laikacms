/**
 * Run Lume dev server and LaikaCMS admin sidecar concurrently.
 *
 * Uses Deno.Command rather than a Node.js `concurrently` package so no
 * extra dependencies are needed. Both processes are killed when this
 * script exits (SIGINT / SIGTERM).
 */

const LUME_CMD = [
  'deno', 'run', '-A',
  'https://deno.land/x/lume/ci.ts',
  '--serve', '--port=4000',
];

const ADMIN_CMD = [
  'deno', 'run',
  '--allow-net', '--allow-read', '--allow-write',
  'admin/server.ts',
];

const site = new Deno.Command(LUME_CMD[0], {
  args: LUME_CMD.slice(1),
  stdout: 'inherit',
  stderr: 'inherit',
}).spawn();

const admin = new Deno.Command(ADMIN_CMD[0], {
  args: ADMIN_CMD.slice(1),
  stdout: 'inherit',
  stderr: 'inherit',
}).spawn();

const cleanup = () => {
  try { site.kill(); } catch { /* already dead */ }
  try { admin.kill(); } catch { /* already dead */ }
  Deno.exit(0);
};

Deno.addSignalListener('SIGINT', cleanup);
Deno.addSignalListener('SIGTERM', cleanup);

await Promise.all([site.status, admin.status]);
