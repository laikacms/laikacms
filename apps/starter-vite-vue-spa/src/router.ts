import { createRouter, createWebHistory } from 'vue-router';

import Home from './views/Home.vue';
import Post from './views/Post.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
    { path: '/posts/:slug', component: Post, props: true },
  ],
});
