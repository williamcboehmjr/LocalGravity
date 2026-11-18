import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@shared': path.resolve(import.meta.dirname, '../shared'),
    },
  },
  build: {
    chunkSizeWarningLimit: 750,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const norm = id.replace(/\\/g, '/');
          if (!norm.includes('/node_modules/')) return undefined;
          if (
            norm.includes('/node_modules/react/') ||
            norm.includes('/node_modules/react-dom/') ||
            norm.includes('/node_modules/scheduler/') ||
            norm.includes('/node_modules/zustand/')
          ) {
            return 'vendor-react';
          }
          if (
            norm.includes('/node_modules/@monaco-editor/') ||
            norm.includes('/node_modules/monaco-editor/')
          ) {
            return 'vendor-monaco';
          }
          if (norm.includes('/node_modules/@xterm/')) {
            return 'vendor-xterm';
          }
          if (
            norm.includes('/node_modules/react-markdown/') ||
            norm.includes('/node_modules/remark-') ||
            norm.includes('/node_modules/rehype-') ||
            norm.includes('/node_modules/unified/') ||
            norm.includes('/node_modules/mdast-') ||
            norm.includes('/node_modules/micromark')
          ) {
            return 'vendor-markdown';
          }
          if (norm.includes('/node_modules/lucide-react/')) {
            return 'vendor-lucide';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  clearScreen: false,
});
