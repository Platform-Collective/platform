// SPDX-License-Identifier: EPL-2.0

import { getBoundedImageDimensions, shouldAnchorImageTop } from '../image'

describe('getBoundedImageDimensions', () => {
  const bounds = { minWidth: 64, maxWidth: 400, minHeight: 64, maxHeight: 400 }

  it.each([
    { width: 300, height: 3600 },
    { width: 300, height: 4000 },
    { width: 300, height: 1200 }
  ])('keeps tall images at their original width when scaling would make them too narrow: %j', (size) => {
    expect(getBoundedImageDimensions(size, bounds)).toEqual({
      width: 300,
      height: 400,
      fit: 'cover'
    })
  })

  it.each([
    { width: 800, height: 16000 },
    { width: 640, height: 4000 },
    { width: 640, height: 4001 },
    { width: 400, height: 1600 },
    { width: 400, height: 2000 }
  ])('caps the readable width of tall images at the maximum width: %j', (size) => {
    expect(getBoundedImageDimensions(size, bounds)).toEqual({
      width: 400,
      height: 400,
      fit: 'cover'
    })
  })

  it('enforces the minimum width for tall images narrower than the minimum', () => {
    expect(getBoundedImageDimensions({ width: 40, height: 3600 }, bounds)).toEqual({
      width: 64,
      height: 400,
      fit: 'cover'
    })
  })

  it.each([
    { width: 3600, height: 300 },
    { width: 4000, height: 200 }
  ])('crops wide images to the minimum height: %j', (size) => {
    expect(getBoundedImageDimensions(size, bounds)).toEqual({
      width: 400,
      height: 64,
      fit: 'cover'
    })
  })

  it.each([
    { width: 20, height: 40 },
    { width: 40, height: 40 }
  ])('enforces both minimum dimensions for small images: %j', (size) => {
    expect(getBoundedImageDimensions(size, bounds)).toEqual({
      width: 64,
      height: 64,
      fit: 'cover'
    })
  })

  it.each([
    [
      { width: 800, height: 400 },
      { width: 400, height: 200, fit: 'contain' }
    ],
    [
      { width: 300, height: 800 },
      { width: 150, height: 400, fit: 'contain' }
    ],
    [
      { width: 100, height: 200 },
      { width: 100, height: 200, fit: 'contain' }
    ],
    [
      { width: 400, height: 800 },
      { width: 200, height: 400, fit: 'contain' }
    ]
  ])('preserves the aspect ratio when the scaled image fits the bounds: %j', (size, expected) => {
    expect(getBoundedImageDimensions(size, bounds)).toEqual(expected)
  })

  it.each<[number, number, 'cover' | 'contain']>([
    [799, 200, 'contain'],
    [800, 200, 'contain'],
    [801, 400, 'cover']
  ])('switches to a readable crop only below half the bounded source width: 400×%i', (height, width, fit) => {
    expect(getBoundedImageDimensions({ width: 400, height }, bounds)).toEqual({ width, height: 400, fit })
  })

  it.each<[number, number, 'cover' | 'contain']>([
    [800, 64, 'contain'],
    [801, 128, 'cover']
  ])('switches to a readable crop only below the minimum width: 128×%i', (height, width, fit) => {
    expect(getBoundedImageDimensions({ width: 128, height }, bounds)).toEqual({ width, height: 400, fit })
  })

  it.each([
    {},
    { width: 400 },
    { height: 400 },
    { width: undefined, height: 400 },
    { width: 400, height: undefined },
    { width: 0, height: 400 },
    { width: 400, height: 0 },
    { width: 0, height: 0 },
    { width: -1, height: 400 },
    { width: 400, height: -1 },
    { width: NaN, height: 400 },
    { width: 400, height: NaN },
    { width: Infinity, height: 400 },
    { width: 400, height: Infinity },
    { width: -Infinity, height: 400 },
    { width: 400, height: -Infinity }
  ])('falls back to the supplied minimum dimensions for invalid metadata: %p', (size) => {
    expect(getBoundedImageDimensions(size, bounds)).toEqual({ width: 64, height: 64, fit: 'cover' })
    expect(getBoundedImageDimensions(size, { ...bounds, minWidth: 80, minHeight: 48 })).toEqual({
      width: 80,
      height: 48,
      fit: 'cover'
    })
  })

  it.each([376, 392])('uses the supplied bounds for link preview images with a maximum width of %i', (maxWidth) => {
    const linkBounds = { minWidth: 64, maxWidth, minHeight: 64, maxHeight: 240 }

    expect(getBoundedImageDimensions({ width: 300, height: 4000 }, linkBounds)).toEqual({
      width: 300,
      height: 240,
      fit: 'cover'
    })
    expect(getBoundedImageDimensions({ width: 800, height: 16000 }, linkBounds)).toEqual({
      width: maxWidth,
      height: 240,
      fit: 'cover'
    })
    expect(getBoundedImageDimensions({ width: 300, height: 480 }, linkBounds)).toEqual({
      width: 150,
      height: 240,
      fit: 'contain'
    })
  })
})

describe('shouldAnchorImageTop', () => {
  const bounds = { minWidth: 64, maxWidth: 400, minHeight: 64, maxHeight: 400 }

  it.each([
    { width: 300, height: 4000 },
    { width: 400, height: 801 },
    { width: 40, height: 3600 }
  ])('anchors cropped tall images at the top: %j', (size) => {
    const { fit } = getBoundedImageDimensions(size, bounds)

    expect(fit).toBe('cover')
    expect(shouldAnchorImageTop(fit)).toBe(true)
  })

  it.each([
    { width: 800, height: 400 },
    { width: 400, height: 800 },
    { width: 300, height: 800 },
    { width: 300, height: 300 }
  ])('keeps uncropped images centred: %j', (size) => {
    const { fit } = getBoundedImageDimensions(size, bounds)

    expect(fit).toBe('contain')
    expect(shouldAnchorImageTop(fit)).toBe(false)
  })

  it.each(['contain', 'fill', 'none', 'scale-down', '', undefined])('does not anchor uncropped fits: %p', (fit) => {
    expect(shouldAnchorImageTop(fit)).toBe(false)
  })
})
