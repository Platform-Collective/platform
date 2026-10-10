// SPDX-License-Identifier: EPL-2.0
import { createTextCache } from '../patch-text'

describe('createTextCache', () => {
  it('keeps only the most recently used diffs', async () => {
    const load = jest.fn(async (file: string) => `text of ${file}`)
    const get = createTextCache(load, 2)
    await get('a', 'Patch.diff')
    await get('b', 'Patch.diff')
    await get('a', 'Patch.diff')
    await get('c', 'Patch.diff')
    // b was the least recently used one
    await get('a', 'Patch.diff')
    await get('b', 'Patch.diff')
    expect(load.mock.calls.map(([file]) => file)).toEqual(['a', 'b', 'c', 'b'])
  })

  it('downloads each blob once', async () => {
    const load = jest.fn(async (file: string) => `text of ${file}`)
    const get = createTextCache(load)
    expect(await get('a', 'Patch.diff')).toBe('text of a')
    expect(await get('a', 'Patch.diff')).toBe('text of a')
    expect(await get('b', 'Patch.diff')).toBe('text of b')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('tries a failed download again', async () => {
    const load = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('ok')
    const get = createTextCache(load)
    await expect(get('a', 'Patch.diff')).rejects.toThrow('offline')
    expect(await get('a', 'Patch.diff')).toBe('ok')
  })

  it('caches any parsed value per blob', async () => {
    const load = jest.fn(async (file: string) => file.length)
    const get = createTextCache<number>(load)
    expect(await get('abc', 'patch.diff')).toBe(3)
    expect(await get('abc', 'patch.diff')).toBe(3)
    expect(load).toHaveBeenCalledTimes(1)
  })
})
