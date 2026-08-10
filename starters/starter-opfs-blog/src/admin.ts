/**
 * Admin entry point (served by Vite at /admin/).
 *
 * Order matters: `./local-session.js` patches `fetch` as an import side
 * effect and must be imported before `./cms.js` pulls in the Decap app.
 *
 * The backend config uses `dev_token`, so the admin auto-logs-in (no OAuth,
 * no server) and talks straight to the injected in-browser repositories.
 * A small bar above the CMS switches between OPFS and a picked local folder,
 * and restores access when a persisted handle's permission lapses.
 */
import { LOCAL_API_BASE, LOCAL_DEV_TOKEN } from './local-session.js';
import { init } from './cms.js';
import { blogCollections } from './decap-config.js';
import {
  currentMode,
  localAccessState,
  pickLocalFolder,
  requestLocalAccess,
  supportsLocalFolders,
  useOpfs,
} from './storage.js';

async function renderStorageBar(): Promise<void> {
  const bar = document.createElement('div');
  bar.style.cssText = 'padding:6px 12px;background:#1e293b;color:#e2e8f0;'
    + 'font:13px system-ui,sans-serif;display:flex;gap:12px;align-items:center;flex-wrap:wrap;';

  const label = document.createElement('span');
  const mode = currentMode();
  label.textContent = mode === 'opfs'
    ? 'Storage: browser (OPFS)'
    : 'Storage: local folder';
  bar.append(label);

  const button = (text: string, onClick: () => void | Promise<void>): HTMLButtonElement => {
    const el = document.createElement('button');
    el.textContent = text;
    el.style.cssText = 'padding:2px 10px;cursor:pointer;';
    el.addEventListener('click', () => void onClick());
    bar.append(el);
    return el;
  };

  if (mode === 'local') {
    button('Switch to browser storage (OPFS)', () => {
      useOpfs();
      window.location.reload();
    });
    // A persisted handle can silently fall back to 'prompt' between visits;
    // re-requesting needs a user gesture, hence a button instead of auto-fix.
    if (await localAccessState() === 'prompt') {
      const restore = button('Restore folder access', async () => {
        if (await requestLocalAccess() === 'granted') window.location.reload();
      });
      restore.style.background = '#f59e0b';
    }
  }
  if (supportsLocalFolders) {
    button(mode === 'local' ? 'Pick a different folder…' : 'Use a local folder…', async () => {
      if (await pickLocalFolder()) window.location.reload();
    });
  } else if (mode === 'opfs') {
    const note = document.createElement('span');
    note.textContent = '(local folders need a Chromium browser)';
    note.style.opacity = '0.7';
    bar.append(note);
  }

  document.body.prepend(bar);
}

void renderStorageBar();

init({
  config: {
    // The complete config is inline; do not also fetch /admin/config.yml.
    load_config_file: false,
    backend: {
      name: 'laika',
      base_url: window.location.origin,
      api_root: LOCAL_API_BASE,
      // Skips the PKCE OAuth dance; the fetch shim answers the session check.
      dev_token: LOCAL_DEV_TOKEN,
    },
    media_folder: 'uploads',
    collections: blogCollections,
  } as any,
});
