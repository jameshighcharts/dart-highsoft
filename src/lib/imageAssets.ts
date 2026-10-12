import type { StaticImageData } from 'next/image';

/**
 * The URL of an imported image. Next serves imported images under content-hashed URLs cached for
 * a year (`immutable`), so a browser never asks for one twice; tests (plain Vite) import the URL.
 */
export function imageUrl(image: StaticImageData | string): string {
  return typeof image === 'string' ? image : image.src;
}

/** The widths Next's image optimizer serves (its default `imageSizes` and `deviceSizes`). */
const OPTIMIZER_WIDTHS = [32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840];

/** Pictures are fetched at three times their CSS size, so they stay sharp on 3x screens. */
export const IMAGE_DENSITY = 3;

/** Quality for optimized photos; must be listed in `images.qualities` (next.config.ts). */
export const PHOTO_QUALITY = 85;

/**
 * `src` for a remote picture shown `cssPx` wide, resized and re-encoded by Next's image optimizer
 * and cached by the CDN and browsers (see `images` in next.config.ts). The source URL must change
 * when the picture does (uploads carry a `?v=` version).
 */
export function optimizedImageUrl(source: string, cssPx: number): string {
  const wanted = cssPx * IMAGE_DENSITY;
  const width = OPTIMIZER_WIDTHS.find((candidate) => candidate >= wanted) ?? OPTIMIZER_WIDTHS[OPTIMIZER_WIDTHS.length - 1];
  return `/_next/image?url=${encodeURIComponent(source)}&w=${width}&q=${PHOTO_QUALITY}`;
}
