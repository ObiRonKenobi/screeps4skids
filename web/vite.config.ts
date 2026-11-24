import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:21080', ws: true }
    }
  },
  preview: {
    host: '127.0.0.1',
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:21080', ws: true }
    }
  }
});
