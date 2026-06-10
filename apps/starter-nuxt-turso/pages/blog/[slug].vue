<script setup lang="ts">
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
      <pre style="white-space:pre-wrap;font-family:inherit">{{ post?.body }}</pre>
    </article>

    <p><NuxtLink to="/">← Back</NuxtLink></p>
  </div>
</template>
