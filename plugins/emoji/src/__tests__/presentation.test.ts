// SPDX-License-Identifier: EPL-2.0

import emojiData from 'emojibase-data/en/data.json'
import { getEmojiCodePoints, getEmojiFromCodePoints } from '../presentation'

describe('emoji icon presentation', () => {
  it('stores the displayed desktop computer instead of its selector-free hexcode', () => {
    const desktop = emojiData.find((emoji) => emoji.hexcode === '1F5A5')
    expect(desktop).toBeDefined()
    expect(getEmojiCodePoints(desktop?.emoji ?? '')).toEqual([0x1f5a5, 0xfe0f])
  })

  it.each([0x1f5a5, 0x2600, 0x260e, 0x2708, 0x2764])(
    'restores emoji presentation for legacy scalar and array icons: %s',
    (code) => {
      const expected = String.fromCodePoint(code, 0xfe0f)
      expect(getEmojiFromCodePoints(code)).toBe(expected)
      expect(getEmojiFromCodePoints([code])).toBe(expected)
      expect(getEmojiFromCodePoints([code, 0xfe0f])).toBe(expected)
    }
  )

  const emojis = emojiData.flatMap((emoji) => [emoji, ...(emoji.skins ?? [])])

  it.each(emojis.map((emoji) => [emoji.hexcode, emoji] as const))(
    'matches the picker for new and legacy values of %s',
    (_hexcode, emoji) => {
      const selected = getEmojiCodePoints(emoji.emoji)
      expect(String.fromCodePoint(...selected)).toBe(emoji.emoji)
      expect(getEmojiFromCodePoints(selected)).toBe(emoji.emoji)

      const legacy = emoji.hexcode.split('-').map((code) => parseInt(code, 16))
      expect(getEmojiFromCodePoints(legacy)).toBe(emoji.emoji)
      expect(getEmojiFromCodePoints(selected.filter((code) => code !== 0xfe0f))).toBe(emoji.emoji)
    }
  )

  it.each(
    [
      [0x1f44d, 0x1f3fd],
      [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467],
      [0x1f1ec, 0x1f1e7],
      [0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f],
      [0x2600, 0xfe0e],
      [0x41],
      []
    ].map((codes) => ({ codes }))
  )('preserves sequences without a matching emoji presentation: $codes', ({ codes }) => {
    const original = [...codes]
    expect(getEmojiFromCodePoints(codes)).toBe(String.fromCodePoint(...codes))
    expect(codes).toEqual(original)
  })

  it('restores selectors inside legacy ZWJ and keycap sequences', () => {
    expect(getEmojiFromCodePoints([0x1f3f3, 0x200d, 0x1f308])).toBe('\u{1F3F3}\uFE0F\u200D\u{1F308}')
    expect(getEmojiFromCodePoints([0x31, 0x20e3])).toBe('1\uFE0F\u20E3')
    expect(getEmojiFromCodePoints([0x1f3cb, 0x1f3fd, 0x200d, 0x2642])).toBe('\u{1F3CB}\u{1F3FD}\u200D\u2642\uFE0F')
  })
})

describe('unknown presentation selectors', () => {
  it.each([
    [0xfe0f, 0x1f5a5],
    [0x1f5a5, 0xfe0f, 0xfe0f],
    [0x1f3f3, 0x200d, 0xfe0f, 0x26a7]
  ])('preserves misplaced or repeated selectors (%p)', (...points: number[]) => {
    expect(getEmojiFromCodePoints(points)).toBe(String.fromCodePoint(...points))
  })

  it.each([
    [0x1f3f3, 0xfe0f, 0x200d, 0x26a7],
    [0x1f3f3, 0x200d, 0x26a7, 0xfe0f]
  ])('restores a partially qualified sequence (%p)', (...points: number[]) => {
    expect(getEmojiFromCodePoints(points)).toBe(String.fromCodePoint(0x1f3f3, 0xfe0f, 0x200d, 0x26a7, 0xfe0f))
  })
})

describe('invalid stored icon codepoints', () => {
  it.each([0xdeadbeef, -1, 0x110000, 1.5, NaN, Infinity, -Infinity])(
    'does not throw for invalid scalar or array codepoints: %s',
    (point) => {
      expect(getEmojiFromCodePoints(point)).toBe('')
      expect(getEmojiFromCodePoints([0x1f5a5, point])).toBe('')
    }
  )

  it('preserves the valid Unicode boundaries', () => {
    expect(getEmojiFromCodePoints(0)).toBe('\0')
    expect(getEmojiFromCodePoints(0x10ffff)).toBe('\u{10FFFF}')
  })

  it('converts a long stored sequence without spreading it into function arguments', () => {
    expect(getEmojiFromCodePoints(Array(150000).fill(0x41))).toBe('A'.repeat(150000))
  })
})
