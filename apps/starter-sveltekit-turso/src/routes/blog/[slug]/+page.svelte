<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<article>
  <h1>{data.title}</h1>
  {#if data.date}
    <time style="color:#666">{new Date(data.date).toLocaleDateString()}</time>
  {/if}
  {#if data.description}
    <p><em>{data.description}</em></p>
  {/if}
  <!-- body is raw markdown; pipe through remark/unified in production -->
  <pre style="white-space:pre-wrap;font-family:inherit">{data.body}</pre>
</article>

<p><a href="/">← Back</a></p>
