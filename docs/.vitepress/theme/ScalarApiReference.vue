<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps<{ url: string }>();
const el = ref<HTMLElement>();
let destroy: (() => void) | undefined;

onMounted(async () => {
  // Dynamic import so @scalar/api-reference (browser-only) is excluded from the SSR bundle.
  const [{ createApiReference }] = await Promise.all([
    import('@scalar/api-reference'),
    // CSS is side-effect-only; Vite injects it when the chunk loads.
    import('@scalar/api-reference/style.css'),
  ]);
  if (!el.value) return;
  const instance = createApiReference(el.value, {
    url: props.url,
    // Phase 1: read-only reference — hide the interactive client panel.
    hideClientButton: true,
  });
  destroy = instance.destroy;
});

onBeforeUnmount(() => destroy?.());
</script>

<template>
  <div ref="el" class="scalar-api-reference" />
</template>

<style>
.scalar-api-reference {
  /* Give Scalar enough room to show its full sidebar + content layout. */
  min-height: 80vh;
}
</style>
