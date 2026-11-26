// SPDX-License-Identifier: EPL-2.0

export interface ImageDimensions {
  width: number
  height: number
  fit: 'cover' | 'contain'
}

/**
 * Calculate thumbnail dimensions from image size and valid positive pixel bounds.
 * Preserve the whole image until proportional scaling makes it narrower than the
 * minimum width or half its bounded source width. Below that threshold, switch
 * to a readable-width cover crop. This is intentionally a discrete change: with
 * 64–400 pixel bounds, 400×800 is 200×400 contain, but 400×801 is 400×400 cover.
 * Images whose scaled height is below the minimum height are cover-cropped to fill
 * a box of the minimum height.
 * Small images may be enlarged to satisfy both minimum dimensions.
 * Missing, non-finite or non-positive source dimensions use a minimum-size cover crop.
 */
export function getBoundedImageDimensions (
  size: { width?: number, height?: number },
  bounds: { maxWidth: number, minWidth: number, maxHeight: number, minHeight: number }
): ImageDimensions {
  if (
    size.width === undefined ||
    size.height === undefined ||
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    return { width: Math.round(bounds.minWidth), height: Math.round(bounds.minHeight), fit: 'cover' }
  }

  const ratio = size.height / size.width

  let width = Math.min(size.width, bounds.maxWidth)
  let height = Math.ceil(width * ratio)

  if (height > bounds.maxHeight) {
    width = bounds.maxHeight / ratio
    height = bounds.maxHeight
  }

  const readableWidth = Math.max(bounds.minWidth, Math.min(size.width, bounds.maxWidth))
  const cropTallImage = width < Math.max(bounds.minWidth, readableWidth / 2)
  const fit = cropTallImage || height < bounds.minHeight ? 'cover' : 'contain'
  if (cropTallImage) {
    // Keep a readable width and crop instead of scaling tall images into a sliver.
    width = readableWidth
  }
  height = Math.max(height, bounds.minHeight)

  return { width: Math.round(width), height: Math.round(height), fit }
}

/**
 * Only cover-fitted images are cropped by the browser. Anchor those crops at the
 * top so the start of a tall screenshot stays visible; uncropped (contain)
 * images keep the default centred position.
 */
export function shouldAnchorImageTop (fit: string | undefined): boolean {
  return fit === 'cover'
}
