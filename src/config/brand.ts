/**
 * Brand text and logos. Colours live in styles/theme.css.
 *
 * Logos live in public/brand/: one for dark backgrounds (title screen, share
 * card) and one for light backgrounds (delivery note, trailer roof). If a
 * logo path is empty, a "LOGO" placeholder is drawn instead.
 */
const neutral = import.meta.env.VITE_NEUTRAL_BRAND === '1';

export type LogoVariant = 'onDark' | 'onLight';

interface Brand {
  stationName: string;
  gameName: string;
  /** Shown on the share card. */
  shareUrlText: string;
  /** Used in the share text – the page the game is embedded on. */
  shareUrl: string;
  logos: Record<LogoVariant, string>;
  /** Paint the light-background logo on the player's trailer roof. */
  trailerRoofLogo: boolean;
}

export const BRAND: Brand = neutral
  ? {
      stationName: 'Your Station',
      gameName: 'Yard Master',
      shareUrlText: 'example.com/yardmaster',
      shareUrl: 'https://example.com/yardmaster',
      logos: { onDark: '', onLight: '' },
      trailerRoofLogo: false,
    }
  : {
      stationName: 'HGV1 Radio',
      gameName: 'Yard Master',
      // Provisional address – confirm before launch.
      shareUrlText: 'projectchimera.co.uk/yardmaster',
      shareUrl: 'https://projectchimera.co.uk/yardmaster',
      logos: { onDark: './brand/logo-on-dark.webp', onLight: './brand/logo-on-light.webp' },
      trailerRoofLogo: true,
    };

const images: Partial<Record<LogoVariant, HTMLImageElement>> = {};

function image(variant: LogoVariant): HTMLImageElement | null {
  const src = BRAND.logos[variant];
  if (!src) return null;
  let img = images[variant];
  if (!img) {
    img = new Image();
    img.src = src;
    images[variant] = img;
  }
  return img;
}

/** Start loading the logos early so they're ready for the canvas. */
export function preloadBrand(): void {
  image('onDark');
  image('onLight');
}

/** The logo once loaded, else null (callers draw a placeholder). */
export function brandLogo(variant: LogoVariant): HTMLImageElement | null {
  const img = image(variant);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}
