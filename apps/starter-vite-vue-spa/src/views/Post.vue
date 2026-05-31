<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';

const props = defineProps<{ slug: string }>();

interface Post {
  title: string;
  body: string;
  date: string | null;
}

const post = ref<Post | null>(null);
const notFound = ref(false);

async function load(slug: string) {
  notFound.value = false;
  post.value = null;
  const res = await fetch(`/api/posts/${encodeURIComponent(slug)}`);
  if (res.status === 404) {
    notFound.value = true;
    return;
  }
  const body = (await res.json()) as { post: { content?: Record<string, unknown> } };
  const content = (body.post.content ?? {}) as Record<string, unknown>;
  post.value = {
    title: (content.title as string) ?? slug,
    body: (content.body as string) ?? '',
    date: (content.date as string) ?? null,
  };
}

onMounted(() => load(props.slug));
watch(() => props.slug, load);
</script>

<template>
  <article v-if="post">
    <h2 style="margin-bottom: 0.25rem;">{{ post.title }}</h2>
    <small v-if="post.date" style="color: #666;">
      {{ new Date(post.date).toLocaleDateString() }}
    </small>
    <div style="margin-top: 1.5rem; white-space: pre-wrap;">{{ post.body }}</div>
  </article>
  <p v-else-if="notFound">Post not found.</p>
  <p v-else><em>Loading…</em></p>
</template>
