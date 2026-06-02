<script setup lang="ts">
const route = useRoute();
const slug = route.params.slug as string;

const { data: post, error } = await useFetch(`/api/posts/${slug}`);
if (error.value) throw createError({ statusCode: 404 });
</script>

<template>
  <div>
    <Head>
      <Title>{{ (post as any)?.title ?? slug }}</Title>
    </Head>

    <article v-if="post">
      <h1>{{ (post as any).title ?? slug }}</h1>
      <time v-if="(post as any).date">{{ new Date((post as any).date).toLocaleDateString() }}</time>
      <p v-if="(post as any).description"><em>{{ (post as any).description }}</em></p>
      <pre style="white-space:pre-wrap;font-family:inherit">{{ (post as any).body }}</pre>
    </article>

    <p><NuxtLink to="/">← Back</NuxtLink></p>
  </div>
</template>
