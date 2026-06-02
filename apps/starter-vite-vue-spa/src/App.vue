<template>
  <header style="margin-bottom: 2rem;">
    <RouterLink to="/" style="text-decoration: none; color: inherit;">
      <h1 style="margin: 0;">LaikaCMS blog</h1>
    </RouterLink>
    <nav style="margin-top: 0.5rem;">
      <RouterLink to="/" style="margin-right: 1rem;">Home</RouterLink>
      <!-- /admin is served by the sidecar Hono backend; proxied through Vite in dev. -->
      <a href="/admin">Admin</a>
    </nav>
  </header>
  <main>
    <RouterView />
  </main>
</template>
