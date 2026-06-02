<nav>
  <a href="/">Blog</a>
  <a href="/admin">Admin</a>
</nav>

<main>
  <slot />
</main>

<style>
  :global(*) {
    box-sizing: border-box;
  }
  :global(body) {
    font-family: system-ui, sans-serif;
    max-width: 720px;
    margin: 0 auto;
    padding: 2rem 1rem;
    line-height: 1.6;
    color: #1a1a1a;
  }
  nav {
    margin-bottom: 2rem;
  }
  nav a {
    margin-right: 1rem;
    color: inherit;
    text-decoration: none;
  }
</style>
