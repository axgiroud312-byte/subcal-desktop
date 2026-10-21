import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
    },
  },
  // Pre-bundle the complete interaction stack before the first Electron render.
  // Late discovery can otherwise mix old/new React chunks when HMR is disabled.
  optimizeDeps: {
    include: ['react', 'react-dom/client', 'react/jsx-runtime', '@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities', 'motion/react', 'recharts', 'sonner', 'lucide-react'],
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
