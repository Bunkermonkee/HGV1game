import { defineConfig } from 'vite';

// `base: './'` makes every asset path relative, so the built `dist/` folder
// works from any sub-folder (e.g. /games/yardmaster/) with no rebuild.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    assetsInlineLimit: 8192,
    sourcemap: false,
  },
});
