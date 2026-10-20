// SPDX-License-Identifier: EPL-2.0

import type { EmojiWithGroup, Locale } from '@hcengineering/emoji'
import { unicodeEmojiStore } from './store'
import { getEmojiByEmoticon, loadUnicodeEmojis } from './utils'

jest.mock('@hcengineering/emoji', () => ({
  ...jest.requireActual('../../emoji/src/utils'),
  ...jest.requireActual('../../emoji/src/types')
}))
jest.mock('../../emoji/src/plugin', () => ({ functions: {} }))
jest.mock('@hcengineering/platform', () => ({}))
jest.mock('@hcengineering/ui', () => ({}))
jest.mock('./types', () => ({ emojiCategories: [] }))
// The svelte runtime is ESM-only and cannot be loaded by jest here, so use a minimal store stub
jest.mock('svelte/store', () => {
  interface Store<T> {
    set: (value: T) => void
    subscribe: (run: (value: T) => void) => () => void
  }
  function writable<T> (value: T): Store<T> {
    const subscribers = new Set<(value: T) => void>()
    return {
      set: (next: T) => {
        value = next
        subscribers.forEach((run) => {
          run(value)
        })
      },
      subscribe: (run: (value: T) => void) => {
        subscribers.add(run)
        run(value)
        return () => subscribers.delete(run)
      }
    }
  }
  function get<T> (store: Store<T>): T {
    let value: T | undefined
    store.subscribe((v) => (value = v))()
    return value as T
  }
  return { writable, get }
})
jest.mock('./store', () => {
  const { writable } = jest.requireMock('svelte/store')
  return { unicodeEmojiStore: writable([]), customEmojiStore: writable([]), getSkinTone: () => 0 }
})

describe('getEmojiByEmoticon', () => {
  let emojis: EmojiWithGroup[]

  beforeEach(async () => {
    emojis = await loadUnicodeEmojis('en')
    unicodeEmojiStore.set(emojis)
  })

  it.each([
    [';-)', ';)', '😉'],
    [':-)', ':)', '🙂'],
    [':-(', ':(', '☹️'],
    [':-D', ':D', '😄'],
    [':-P', ':P', '😛'],
    [":'-)", ":')", '😂'],
    ['>:-(', '>:(', '👿'],
    ['D-:', 'D:', '😩']
  ])('resolves %s and its canonical form %s', (alias, canonical, emoji) => {
    expect(getEmojiByEmoticon(alias)).toBe(emoji)
    expect(getEmojiByEmoticon(canonical)).toBe(emoji)
  })

  it('preserves every exact emoticon from the dataset, including array entries', () => {
    for (const emoji of emojis) {
      if (!('emoticon' in emoji) || emoji.emoticon === undefined) continue
      const emoticons = Array.isArray(emoji.emoticon) ? emoji.emoticon : [emoji.emoticon]
      for (const emoticon of emoticons) {
        expect(getEmojiByEmoticon(emoticon)).toBe(emoji.emoji)
      }
    }
  })

  it('prefers an exact match even when the normalized match occurs first', () => {
    const wink = emojis.find((emoji) => 'hexcode' in emoji && emoji.hexcode === '1F609')
    if (wink === undefined) throw new Error('Missing winking face fixture')
    unicodeEmojiStore.set([wink, { ...wink, emoticon: ';-)', emoji: '🙂' }])

    expect(getEmojiByEmoticon(';-)')).toBe('🙂')
  })

  it.each([undefined, '', 'unknown', ':--)', '<-3', ':-)text', '; -)'])('leaves %s unresolved', (value) => {
    expect(getEmojiByEmoticon(value)).toBeUndefined()
  })

  const locales: Locale[] = [
    'bn',
    'da',
    'de',
    'en',
    'en-gb',
    'es',
    'es-mx',
    'et',
    'fi',
    'fr',
    'hi',
    'hu',
    'it',
    'ja',
    'ko',
    'lt',
    'ms',
    'nb',
    'nl',
    'pl',
    'pt',
    'ru',
    'sv',
    'th',
    'uk',
    'vi',
    'zh',
    'zh-hant'
  ]

  it.each(locales)('resolves both wink variants after loading the %s dataset', async (locale) => {
    unicodeEmojiStore.set(await loadUnicodeEmojis(locale))

    expect(getEmojiByEmoticon(';)')).toBe('😉')
    expect(getEmojiByEmoticon(';-)')).toBe('😉')
  })
})
