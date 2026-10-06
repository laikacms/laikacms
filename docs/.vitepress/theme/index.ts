import { type Theme, useRoute } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { nextTick, onMounted, watch } from 'vue';

import './custom.css';

// Imported lazily so mermaid stays out of the server build and off pages without diagrams.
const renderMermaid = () => nextTick(() => import('./mermaid').then(m => m.renderMermaid()));

export default {
  extends: DefaultTheme,
  setup() {
    const route = useRoute();
    onMounted(() => {
      void import('./mermaid').then(m => m.watchTheme());
      void renderMermaid();
    });
    watch(() => route.path, () => void renderMermaid());
  },
} satisfies Theme;
