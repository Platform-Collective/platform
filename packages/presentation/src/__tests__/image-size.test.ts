/** @jest-environment jsdom */
// SPDX-License-Identifier: EPL-2.0

import { unknownError } from '@hcengineering/platform'
import { getImageSize } from '../image'

describe('image decode failures', () => {
  const revokeObjectURL = jest.fn()

  beforeEach(() => {
    URL.createObjectURL = jest.fn(() => 'blob:clipboard-image')
    URL.revokeObjectURL = revokeObjectURL
    jest.spyOn(global, 'Image').mockImplementation(() => {
      const image = document.createElement('img')
      jest.spyOn(image, 'src', 'set').mockImplementation((src) => {
        image.setAttribute('src', src)
        queueMicrotask(() => image.dispatchEvent(new Event('error')))
      })
      return image
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
    revokeObjectURL.mockClear()
  })

  it('rejects with an Error instead of the DOM Event that becomes BadError', async () => {
    const failure: unknown = await getImageSize(new Blob(['clipboard'], { type: 'image/webp' })).catch((err) => err)
    expect(failure).toBeInstanceOf(Error)
    expect(unknownError(failure).code).not.toBe('platform:status:BadError')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:clipboard-image')
  })
})
