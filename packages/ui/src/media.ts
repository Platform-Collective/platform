// SPDX-License-Identifier: EPL-2.0

import { readable, type Readable } from 'svelte/store'

export interface MediaSize {
  width: number
  height: number
}

/**
 * Whether a media element of the given size is portrait (taller than wide).
 * Returns undefined while the size is unknown (zero or negative), so callers can fall back with `??`.
 */
export function isPortraitSize (width: number, height: number): boolean | undefined {
  return width > 0 && height > 0 ? height > width : undefined
}

/**
 * Natural size of the image at `url`, undefined until it is loaded (or if `url` is empty).
 * A result that arrives after the store lost its last subscriber (e.g. the url changed) is dropped.
 */
export function loadImageSize (url: string | undefined): Readable<MediaSize | undefined> {
  return readable<MediaSize | undefined>(undefined, (set) => {
    if (url === undefined || url === '') {
      return
    }
    let active = true
    const img = new Image()
    img.onload = () => {
      if (active) {
        set({ width: img.naturalWidth, height: img.naturalHeight })
      }
    }
    img.src = url
    return () => {
      active = false
    }
  })
}
