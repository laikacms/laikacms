<script setup lang="ts">
import { onMounted, ref } from 'vue';

interface PostListItem {
  key: string;
  slug: string;
  title: string | null;
}

const posts = ref<PostListItem[]>([]);
const loaded = ref(false);

onMounted(async () => {
  const res = await fetch('/api/posts');
  const body = (await res.json()) as {
    posts: Array<{ key: string; content?: Record<string, unknown> }>;
  };
  posts.value = body.posts.map(p => ({
    key: p.key,
    slug: p.key.replace(/^posts\//, '').replace(/\.md$/, ''),
    title: (p.content?.title as string) ?? null,
  }));
  loaded.value = true;
});
</script>

<template>
  <section>
    <p>
      Edit posts at <a href="/admin">/admin</a> (Decap CMS). This page is a pure client-side Vue
      SPA — it fetches <code>/api/posts</code> from the sidecar Hono backend.
    </p>
    <ul style="list-style: none; padding: 0;">
      <li v-if="!loaded"><em>Loading…</em></li>
      <li v-else-if="posts.length === 0"><em>No posts yet — add one in the admin UI.</em></li>
      <li v-for="post in posts" :key="post.key" style="margin-bottom: 1rem;">
        <RouterLink :to="`/posts/${post.slug}`">{{ post.title ?? post.slug }}</RouterLink>
      </li>
    </ul>
  </section>
</template>
