/**
 * Canvas colours, read from the CSS variables in styles/theme.css so there is
 * a single theme file for both the HTML UI and the game art.
 */
const FALLBACK = {
  brandPrimary: '#f85f00',
  brandSecondary: '#f85f00',
  uiGood: '#2ecc71',
  uiWarn: '#ffb000',
  uiBad: '#ff3b30',
  uiText: '#ffffff',
  uiFont: 'system-ui, sans-serif',
  uiFontDisplay: 'Arial Black, Arial, sans-serif',
  cabColour: '#f85f00',
  cabRoof: '#d14f00',
  trailerCurtain: '#16181b',
  trailerRoof: '#eef0f2',
  yardTarmac: '#4a4d52',
  yardLineWhite: '#f2f2f2',
  yardLineYellow: '#ffcc00',
  yardKerb: '#9a9a96',
  yardGrass: '#4f7a3a',
  yardBuilding: '#5d6670',
  yardBuildingRoof: '#707a85',
  yardDockDoor: '#8c96a0',
};

export type Theme = typeof FALLBACK;

export const theme: Theme = { ...FALLBACK };

/** camelCase key → --kebab-case CSS variable. */
function cssVar(key: string): string {
  return '--' + key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}

export function loadTheme(): void {
  const style = getComputedStyle(document.documentElement);
  for (const key of Object.keys(FALLBACK) as (keyof Theme)[]) {
    const v = style.getPropertyValue(cssVar(key)).trim();
    if (v) theme[key] = v;
  }
}
