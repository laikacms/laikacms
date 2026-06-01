import { angular } from '@analogjs/vite-plugin-angular';
import { defineConfig } from 'vite';

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [angular()],
  build: {
    rollupOptions: {
      input: isSsrBuild ? 'src/entry-server.ts' : 'index.html',
    },
  },
  ssr: {
    noExternal: [/^@angular\//],
  },
}));
