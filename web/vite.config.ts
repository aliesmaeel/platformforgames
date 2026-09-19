import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.PFG_API ?? 'http://localhost:8787',
        changeOrigin: true
      },
      '/ws': {
        target: process.env.PFG_API ?? 'http://localhost:8787',
        ws: true
      }
    }
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500
  }
});
