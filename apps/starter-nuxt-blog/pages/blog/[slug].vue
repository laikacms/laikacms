<script setup lang="ts">
/**
 * Individual blog post page — fetches a published post via GET /api/posts/:slug.
 *
 * useFetch runs server-side during SSR, returning a 404 if the post doesn't
 * exist (handled below via error.value). The slug comes from the URL parameter.
 */
const route = useRoute();
const slug = route.params.slug as string;

const { data: post, error } = await useFetch(`/api/posts/${slug}`);

if (error.value) {
  throw createError({ statusCode: 404, statusMessage: 'Post not found' });
}
</script>

<template>
  <div>
    <Head>
      <Title>{{ post?.title ?? slug }}</Title>
      <Meta v-if="post?.description" name="description" :content="post.description" />
    </Head>

    <article>
      <h1>{{ post?.title ?? slug }}</h1>
      <time v-if="post?.date">{{ new Date(post.date).toLocaleDateString() }}</time>
      <p v-if="post?.description"><em>{{ post.description }}</em></p>
      <!-- body is raw markdown; render with remark/rehype in a production app -->
      <pre style="white-space:pre-wrap;font-family:inherit">{{ post?.body }}</pre>
    </article>

    <p><NuxtLink to="/">← Back</NuxtLink></p>
  </div>
</template>
