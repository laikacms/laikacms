<script setup lang="ts">
definePageMeta({ layout: false });

const { blogCollections } = await import('~/utils/decap-config');

onMounted(async () => {
  (window as any).CMS_MANUAL_INIT = true;

  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js';
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });

  const { default: createLaikaBackend } = await import(
    '@laikacms/decap-integrations/decap-cms-backend-laika'
  );

  (window as any).CMS.registerBackend('laika', createLaikaBackend());

  (window as any).CMS.init({
    config: {
      backend: { name: 'laika', api_url: '/api/decap' },
      media_folder: 'public/uploads',
      public_folder: '/uploads',
      collections: blogCollections,
    },
  });
});
</script>

<template>
  <Head>
    <Title>Content Manager</Title>
  </Head>
</template>
