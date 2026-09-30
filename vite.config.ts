import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Neutral preview builds (VITE_NEUTRAL_BRAND=1) carry no station branding:
 * drop the <!-- brand:start … brand:end --> tags (icons, social preview
 * meta) and the station name in the title. public/ (logos, icons,
 * og-image.png) isn't copied either – see copyPublicDir below.
 */
function neutralBrand(neutral: boolean): Plugin {
  return {
    name: 'neutral-brand',
    apply: 'build',
    transformIndexHtml(html) {
      if (!neutral) return html;
      return html.replace(/\s*<!-- brand:start[\s\S]*?<!-- brand:end -->/, '').replace(' – HGV1 Radio</title>', '</title>');
    },
  };
}

// `base: './'` makes every asset path relative, so the built `dist/` folder
// works from any sub-folder (e.g. /games/yardmaster/) with no rebuild.
export default defineConfig(({ mode }) => {
  const neutral = loadEnv(mode, '.', 'VITE_').VITE_NEUTRAL_BRAND === '1';
  return {
    base: './',
    plugins: [neutralBrand(neutral)],
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
      copyPublicDir: !neutral,
    },
  };
});
