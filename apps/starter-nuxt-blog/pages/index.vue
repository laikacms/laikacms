<script setup lang="ts">
/**
 * Blog homepage — lists published posts via GET /api/posts.
 *
 * useFetch runs server-side during SSR and client-side during navigation,
 * so the list is always fresh. The key is stable so Nuxt deduplicates the fetch.
 */
const { data: posts } = await useFetch('/api/posts');
</script>

<template>
  <div>
    <Head>
      <Title>My Blog</Title>
    </Head>

    <h1>My Blog</h1>

    <p v-if="!posts || posts.length === 0">
      No posts yet. <NuxtLink to="/admin">Open the CMS</NuxtLink> to write your first post.
    </p>

    <ul v-else style="list-style:none;padding:0">
      <li v-for="post in posts" :key="post.slug" style="margin-bottom:1.5rem">
        <NuxtLink :to="`/blog/${post.slug}`">{{ post.slug }}</NuxtLink>
        <span v-if="post.updatedAt">
          &nbsp;·&nbsp;<time>{{ new Date(post.updatedAt).toLocaleDateString() }}</time>
        </span>
      </li>
    </ul>
  </div>
</template>
