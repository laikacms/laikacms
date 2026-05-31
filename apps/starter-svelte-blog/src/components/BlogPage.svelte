<script lang="ts">
  interface PostSummary {
    slug: string;
    title?: string | null;
    updatedAt?: string | null;
  }

  let { posts }: { posts: PostSummary[] } = $props();
</script>

<svelte:head>
  <title>My Blog</title>
</svelte:head>

<h1>My Blog</h1>

{#if posts.length === 0}
  <p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>
{:else}
  <ul style="list-style:none;padding:0">
    {#each posts as post}
      <li style="margin-bottom:1.5rem">
        <a href="/blog/{post.slug}">{post.title ?? post.slug}</a>
        {#if post.updatedAt}
          &middot; <time>{new Date(post.updatedAt).toLocaleDateString()}</time>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
