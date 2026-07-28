/**
 * Preserve compact fine-pointer layouts while guaranteeing WCAG-sized targets
 * whenever any connected input can be coarse (for example, a touchscreen
 * laptop that also reports a fine trackpad).
 */
export const COARSE_POINTER_MIN_HEIGHT =
  "[@media(any-pointer:coarse)]:min-h-11";

export const COARSE_POINTER_TARGET =
  "[@media(any-pointer:coarse)]:min-h-11 [@media(any-pointer:coarse)]:min-w-11";
