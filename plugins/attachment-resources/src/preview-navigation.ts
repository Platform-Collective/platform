// SPDX-License-Identifier: EPL-2.0

export function getAdjacentImageIndex (index: number, offset: -1 | 1, imageCount: number): number | undefined {
  const nextIndex = index + offset
  return nextIndex >= 0 && nextIndex < imageCount ? nextIndex : undefined
}
