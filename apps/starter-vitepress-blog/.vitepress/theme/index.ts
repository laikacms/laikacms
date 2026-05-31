import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import BlogHome from './BlogHome.vue';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('BlogHome', BlogHome);
  },
} satisfies Theme;
