import { defineConfig } from 'vite';

export default defineConfig({
  base: '/safe_stay/',
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
});
