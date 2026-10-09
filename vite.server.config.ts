import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    ssr: path.resolve(root, 'server.ts'),
    outDir: path.resolve(root, 'dist-server'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'node22',
    rollupOptions: {
      output: {
        entryFileNames: 'server.js',
        format: 'es',
      },
    },
  },
});
