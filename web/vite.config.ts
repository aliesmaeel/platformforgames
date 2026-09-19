import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Listen on all interfaces so a second computer on the LAN can open the
    // dev site (Vite prints the Network URL) and reach /api and /ws through the proxy.
    host: true,
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
  // Pre-bundle the lazily imported peer library so its first use in dev does not trigger a reload.
  optimizeDeps: { include: ['peerjs'] },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500
  }
});
