/**
 * Joblit brand SVG assets — inline strings for popup and widget use.
 * Uses emerald gradient to match the web app's brand identity.
 */

/**
 * Small logo icon (header, collapsed widget). Emerald-gradient rounded tile
 * with a white "J" monogram (top bar + rounded hook) — same geometry as the
 * web app's JoblitMark, so the extension and product share one brand mark.
 */
export function logoIconSvg(size: number = 20): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="jl-grad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#10b981"/>
        <stop offset="100%" stop-color="#059669"/>
      </linearGradient>
    </defs>
    <rect width="24" height="24" rx="6.5" fill="url(#jl-grad)"/>
    <path d="M9.5 7.5 H15.5" stroke="white" stroke-width="2.3" stroke-linecap="round"/>
    <path d="M14 7.5 V13 a4.6 4.6 0 0 1 -9.2 0" stroke="white" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/** Logo as a React-friendly inline component string for dangerouslySetInnerHTML */
export function logoIconHtml(size: number = 20): string {
  return logoIconSvg(size);
}

/** Checkmark SVG for success states */
export function checkmarkSvg(size: number = 24): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 12.5l4 4 8-9" stroke="#059669" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
      stroke-dasharray="24" stroke-dashoffset="0" style="animation: jl-checkDraw 400ms ease forwards;"/>
  </svg>`;
}

/** Error/warning icon */
export function errorIconSvg(size: number = 14): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="8" r="7" stroke="#ef4444" stroke-width="1.5" fill="none"/>
    <line x1="8" y1="4.5" x2="8" y2="9" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round"/>
    <circle cx="8" cy="11.5" r="0.75" fill="#ef4444"/>
  </svg>`;
}

/** Key icon for token input */
export function keyIconSvg(size: number = 14): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="color: var(--jl-text-muted);">
    <circle cx="5.5" cy="6.5" r="3" stroke="currentColor" stroke-width="1.5" fill="none"/>
    <path d="M8 8.5l5 5M11 11.5l2 -2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;
}

/** Spinner SVG (animated via CSS) */
export function spinnerSvg(size: number = 16): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" style="animation: jl-spin 600ms linear infinite;">
    <circle cx="8" cy="8" r="6" stroke="#e5e7eb" stroke-width="2" fill="none"/>
    <path d="M8 2a6 6 0 0 1 6 6" stroke="#059669" stroke-width="2" stroke-linecap="round" fill="none"/>
  </svg>`;
}
