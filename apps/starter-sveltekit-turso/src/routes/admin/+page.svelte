<script lang="ts">
  /**
   * Decap CMS admin UI loaded from CDN.
   * Uses `decapAdminHtml()` from createCustomLaika for the inline HTML pattern,
   * but SvelteKit requires a proper +page.svelte — so we bootstrap CMS from onMount.
   */
  import { onMount } from 'svelte';

  import { blogCollections } from '$lib';

  type WindowWithCMS = Window & typeof globalThis & {
    CMS_MANUAL_INIT: boolean;
    CMS: {
      registerBackend: (name: string, backend: unknown) => void;
      init: (opts: Record<string, unknown>) => void;
    };
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
