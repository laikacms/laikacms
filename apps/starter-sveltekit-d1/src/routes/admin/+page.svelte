<script lang="ts">
  /**
   * Decap CMS admin loaded from CDN via dynamic import.
   * The onMount pattern is the same as starter-sveltekit-turso.
   */
  import { onMount } from 'svelte';

  import { blogCollections } from '$lib';

  type WindowWithCMS = Window &
    typeof globalThis & {
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
