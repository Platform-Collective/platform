// SPDX-License-Identifier: EPL-2.0

import { isPortraitSize, loadImageSize, type MediaSize } from '../media'

// Minimal single-subscriber readable, svelte/store is an ES module Jest cannot load here
jest.mock('svelte/store', () => ({
  readable: (initial: unknown, start: (set: (value: unknown) => void) => (() => void) | undefined) => ({
    subscribe: (run: (value: unknown) => void) => {
      run(initial)
      const stop = start(run)
      return () => {
        stop?.()
      }
    }
  })
}))

function current<T> (store: { subscribe: (run: (value: T) => void) => () => void }): T | undefined {
  let value: T | undefined
  store.subscribe((v) => {
    value = v
  })()
  return value
}

describe('isPortraitSize', () => {
  it('is undefined while the size is unknown', () => {
    expect(isPortraitSize(0, 0)).toBeUndefined()
    expect(isPortraitSize(1920, 0)).toBeUndefined()
    expect(isPortraitSize(0, 1080)).toBeUndefined()
  })

  it('detects portrait and landscape', () => {
    expect(isPortraitSize(1080, 1920)).toBe(true)
    expect(isPortraitSize(1920, 1080)).toBe(false)
    expect(isPortraitSize(1000, 1000)).toBe(false)
  })
})

describe('loadImageSize', () => {
  const OriginalImage = globalThis.Image
  let images: Array<{ onload: (() => void) | null, src: string, naturalWidth: number, naturalHeight: number }>

  beforeEach(() => {
    images = []
    globalThis.Image = jest.fn(() => {
      const img = { onload: null, src: '', naturalWidth: 0, naturalHeight: 0 }
      images.push(img)
      return img
    }) as any
  })

  afterEach(() => {
    globalThis.Image = OriginalImage
  })

  function finish (index: number, width: number, height: number): void {
    images[index].naturalWidth = width
    images[index].naturalHeight = height
    images[index].onload?.()
  }

  it('stays undefined without a url', () => {
    expect(current(loadImageSize(undefined))).toBeUndefined()
    expect(current(loadImageSize(''))).toBeUndefined()
    expect(images).toHaveLength(0)
  })

  it('reports the natural size once loaded', () => {
    let value: MediaSize | undefined
    const unsubscribe = loadImageSize('poster.png').subscribe((v: MediaSize | undefined) => {
      value = v
    })
    expect(value).toBeUndefined()
    expect(images[0].src).toBe('poster.png')
    finish(0, 720, 1280)
    expect(value).toEqual({ width: 720, height: 1280 })
    unsubscribe()
  })

  it('drops a result that arrives after unsubscribe', () => {
    let value: MediaSize | undefined
    const unsubscribe = loadImageSize('old.png').subscribe((v: MediaSize | undefined) => {
      value = v
    })
    unsubscribe()
    finish(0, 720, 1280)
    expect(value).toBeUndefined()
  })
})
