/**
 * Brand text and logo. Colours live in styles/theme.css.
 *
 * Logo: put the file in `public/` (e.g. public/logo.png) and set `logoSrc` to
 * './logo.png'. Until then a placeholder "LOGO" slot is drawn.
 */
const neutral = import.meta.env.VITE_NEUTRAL_BRAND === '1';

export const BRAND = neutral
  ? {
      stationName: 'Your Station',
      gameName: 'Yard Master',
      shareUrlText: 'example.com/yardmaster',
      shareUrl: 'https://example.com/yardmaster',
      logoSrc: '',
    }
  : {
      stationName: 'HGV1 Radio',
      gameName: 'Yard Master',
      /** Shown on the share card and in share text. */
      shareUrlText: 'hgvradio.com/yardmaster',
      shareUrl: 'https://hgvradio.com/yardmaster',
      logoSrc: '',
    };

let logo: HTMLImageElement | null = null;

/** The logo image once loaded, else null (callers draw a placeholder). */
export function brandLogo(): HTMLImageElement | null {
  if (!BRAND.logoSrc) return null;
  if (!logo) {
    logo = new Image();
    logo.src = BRAND.logoSrc;
  }
  return logo.complete && logo.naturalWidth > 0 ? logo : null;
}
