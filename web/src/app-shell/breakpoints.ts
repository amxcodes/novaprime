/**
 * Keep JavaScript navigation behavior aligned with the shell's CSS media
 * queries. CSS cannot use custom properties inside `@media`, so the focused
 * breakpoint contract test checks both sides against this source value.
 */
export const EXPANDED_NAVIGATION_MIN_WIDTH_PX = 1200;
export const EXPANDED_NAVIGATION_MEDIA_QUERY =
  `(min-width: ${EXPANDED_NAVIGATION_MIN_WIDTH_PX}px)`;
