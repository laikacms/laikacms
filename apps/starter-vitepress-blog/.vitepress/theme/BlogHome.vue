<script setup lang="ts">
import { data as posts } from '../../docs/posts.data.js';
</script>

<template>
  <div class="blog-home">
    <h1>My Blog</h1>
    <p>
      <a href="/admin/">Admin →</a>
    </p>
    <ul v-if="posts.length > 0" class="post-list">
      <li v-for="post in posts" :key="post.url">
        <a :href="post.url">{{ post.title }}</a>
        <time v-if="post.date" class="post-date">
          {{ new Date(post.date).toLocaleDateString() }}
        </time>
        <p v-if="post.description" class="post-desc">{{ post.description }}</p>
      </li>
    </ul>
    <p v-else>
      No posts yet.
      <a href="/admin/">Open the CMS</a> to write your first post.
    </p>
  </div>
</template>

<style scoped>
.blog-home {
  max-width: 48rem;
  margin: 2rem auto;
  padding: 0 1rem;
}

.post-list {
  list-style: none;
  padding: 0;
}

.post-list li {
  margin-bottom: 1.5rem;
}

.post-date {
  display: block;
  color: var(--vp-c-text-2);
  font-size: 0.875rem;
  margin-top: 0.25rem;
}

.post-desc {
  color: var(--vp-c-text-2);
  margin-top: 0.25rem;
  font-size: 0.9rem;
}
</style>
