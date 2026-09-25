import { defineConfig } from 'vite';

// `base: './'` makes every asset path relative, so the built `dist/` folder
// works from any sub-folder (e.g. /games/yardmaster/) with no rebuild.
export default defineConfig({
  base: './',
  // `npm run dev` with the leaderboard: run the PHP API separately
  // (php -S 127.0.0.1:8098 -t dist) and it's proxied here as /api.
  server: {
    proxy: { '/api': 'http://127.0.0.1:8098' },
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    assetsInlineLimit: 8192,
    sourcemap: false,
  },
});
