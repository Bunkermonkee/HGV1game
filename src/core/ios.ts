/**
 * Phone browser quirks, mostly iPhone Safari:
 *
 * - It ignores "user-scalable=no", zooms on a quick double tap and enlarges
 *   text when the phone is turned to landscape, and once zoomed nothing puts
 *   it back. `installZoomGuard()` blocks pinch/double-tap zoom while the page
 *   is at normal size, still lets a zoomed page be pinched back out, and
 *   resets the zoom after a rotation.
 * - It only lets videos go full screen. The nearest thing for a game is
 *   "Add to Home Screen": opened from the home screen it runs without any
 *   browser bars. `fullscreenMode()` says which of the two a device gets.
 */

type WebkitDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => void };

/** iPhone, iPod or iPad (iPads report themselves as Macs with touch). */
export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Running as an app from the home screen (no browser bars). */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
}

/** 'api': the browser can go full screen. 'homescreen': iPhone – explain Add to Home Screen. 'none': nothing to offer. */
export function fullscreenMode(): 'api' | 'homescreen' | 'none' {
  const d = document as WebkitDocument;
  // iPhone never lets a page go full screen, whatever it reports.
  if (/iPhone|iPod/.test(navigator.userAgent)) return isStandalone() ? 'none' : 'homescreen';
  if (document.fullscreenEnabled || d.webkitFullscreenEnabled) return 'api';
  if (isIOS() && !isStandalone()) return 'homescreen';
  return 'none';
}

export function isFullscreen(): boolean {
  const d = document as WebkitDocument;
  return !!(document.fullscreenElement || d.webkitFullscreenElement);
}

/** Enter or leave full screen with the standard API, or Safari's prefixed one on iPad. */
export function toggleFullscreenApi(onEntered?: () => void): void {
  const d = document as WebkitDocument;
  if (isFullscreen()) {
    if (document.exitFullscreen) void document.exitFullscreen().catch(() => {});
    else d.webkitExitFullscreen?.();
    return;
  }
  const el = document.documentElement as WebkitElement;
  if (el.requestFullscreen) {
    el.requestFullscreen().then(() => onEntered?.(), () => {});
  } else {
    el.webkitRequestFullscreen?.();
  }
}

function typing(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

export function installZoomGuard(): void {
  const vv = window.visualViewport;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  const base = meta?.getAttribute('content') ?? '';
  const zoomed = () => !!vv && vv.scale > 1.01;

  // Pinch: Safari's gesture events, and two-finger moves anywhere. Block
  // zooming in; if the page is already zoomed, let it be pinched back out.
  for (const type of ['gesturestart', 'gesturechange']) {
    document.addEventListener(type, (e) => {
      if (!zoomed()) e.preventDefault();
    }, { passive: false });
  }
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1 && !zoomed()) e.preventDefault();
  }, { passive: false });
  // Double tap: stopped by `touch-action: manipulation` in the CSS.

  // Snap back to normal size: re-applying the viewport makes Safari drop the zoom.
  const reset = () => {
    if (!meta || !zoomed() || typing()) return;
    meta.setAttribute('content', base.replace('initial-scale=1', 'initial-scale=1.0001'));
    requestAnimationFrame(() => meta.setAttribute('content', base));
  };
  window.addEventListener('orientationchange', () => setTimeout(reset, 400));
  vv?.addEventListener('resize', () => setTimeout(reset, 500));
  document.addEventListener('focusout', () => setTimeout(reset, 300));
}
