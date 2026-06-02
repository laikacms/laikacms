<template>
  <div
    style="
      font-family: system-ui, sans-serif;
      max-width: 720px;
      margin: 0 auto;
      padding: 2rem 1rem;
      line-height: 1.6;
    "
  >
    <nav style="margin-bottom: 2rem">
      <NuxtLink to="/" style="margin-right: 1rem; color: inherit">Blog</NuxtLink>
      <NuxtLink to="/admin" style="color: inherit">Admin</NuxtLink>
    </nav>
    <slot />
  </div>
</template>
