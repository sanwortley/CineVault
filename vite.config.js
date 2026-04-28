import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  base: '/',
  build: {
    outDir: 'dist',
  },
  // Load env vars from process.env (Railway sets them)
  envPrefix: 'VITE_',
});
