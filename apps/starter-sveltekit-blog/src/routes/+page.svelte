<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<h1>My Blog</h1>

{#if data.posts.length === 0}
  <p>No posts yet. <a href="/admin">Open the CMS</a> to write your first post.</p>
{:else}
  <ul>
    {#each data.posts as post (post.key)}
      <li>
        <a href={`/blog/${post.slug}`}>{post.slug}</a>
        {#if post.updatedAt}
          · <time>{new Date(post.updatedAt).toLocaleDateString()}</time>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  ul {
    list-style: none;
    padding: 0;
  }
  li {
    margin-bottom: 1.5rem;
  }
  a {
    color: #0070f3;
  }
  time {
    color: #666;
    font-size: 0.9em;
  }
</style>
