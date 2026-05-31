<script lang="ts">
  interface Post {
    title?: string | null;
    date?: string | null;
    description?: string | null;
    body?: string | null;
  }

  let { slug, post }: { slug: string; post: Post } = $props();
</script>

<svelte:head>
  <title>{post.title ?? slug}</title>
</svelte:head>

<article>
  <h1>{post.title ?? slug}</h1>
  {#if post.date}
    <time>{new Date(post.date).toLocaleDateString()}</time>
  {/if}
  {#if post.description}
    <p><em>{post.description}</em></p>
  {/if}
  <!-- body is raw markdown — pipe through remark/rehype in production -->
  <pre style="white-space:pre-wrap;font-family:inherit">{post.body ?? ''}</pre>
</article>
<p><a href="/">← Back</a></p>
