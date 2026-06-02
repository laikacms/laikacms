<script lang="ts">
  /**
   * Decap CMS admin UI.
   *
   * Pattern: "Decap admin from CDN"
   *   1. CMS_MANUAL_INIT prevents Decap from auto-starting before the laika
   *      backend is registered.
   *   2. decap-cms.js from CDN is injected as a <script> tag on mount.
   *   3. After the CDN script loads, the laika backend is dynamically imported
   *      (bundled by Vite from @laikacms/decap-integrations), registered, and
   *      CMS.init() is called.
   *
   * SvelteKit strips the layout on this route via +layout@.svelte if you need
   * the CMS to occupy the full viewport. The simplest option: add a
   * style="margin:0;padding:0" to body via a <svelte:head> block.
   */
  import { onMount } from 'svelte';

  import { blogCollections } from '$lib';

  type WindowWithCMS = Window & typeof globalThis & {
    CMS_MANUAL_INIT: boolean,
    CMS: {
      registerBackend: (name: string, backend: unknown) => void,
      init: (opts: Record<string, unknown>) => void,
    },
  };

  onMount(() => {
    const win = window as WindowWithCMS;
    win.CMS_MANUAL_INIT = true;

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js';
    script.onload = async () => {
      const { default: createLaikaBackend } = await import(
        '@laikacms/decap-integrations/decap-cms-backend-laika'
      );
      win.CMS.registerBackend('laika', createLaikaBackend());
      win.CMS.init({
        config: {
          backend: { name: 'laika', api_url: '/api/decap' },
          media_folder: 'static/uploads',
          public_folder: '/uploads',
          collections: blogCollections,
        },
      });
    };
    document.head.appendChild(script);
  });
</script>

<svelte:head>
  <title>Content Manager</title>
</svelte:head>
