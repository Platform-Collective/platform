// SPDX-License-Identifier: EPL-2.0

import { emojiPresentationGroups } from './presentation-data'

const emojiPresentation = new Map<string, string>()
for (const [prefixes, suffixes] of emojiPresentationGroups) {
  for (const prefix of prefixes.split(' ')) {
    for (const suffix of suffixes) {
      const emoji = prefix + suffix
      emojiPresentation.set(emoji.replace(/\uFE0F/g, ''), emoji)
    }
  }
}

/**
 * Preserve the picker display sequence, including presentation selectors and supplementary codepoints.
 * @public
 */
export function getEmojiCodePoints (emoji: string): number[] {
  return Array.from(emoji, (character) => character.codePointAt(0) ?? 0)
}

/**
 * Decode the picker hexcode without adding presentation selectors to stored icon values.
 * @public
 */
export function getEmojiCodePointsFromHexcode (hexcode: string): number[] {
  return hexcode.split('-').map((code) => parseInt(code, 16))
}

/**
 * Restore emoji presentation for legacy icon codepoints using a compact lookup generated from the picker's emoji dataset.
 * Unknown sequences and explicit text presentation are preserved.
 * @public
 */
export function getEmojiFromCodePoints (icon: number | number[]): string {
  const points = Array.isArray(icon) ? icon : [icon]
  // Stored icon data may contain invalid codepoints. Keep popup rendering safe as well as icon rendering.
  if (!points.every((point) => Number.isInteger(point) && point >= 0 && point <= 0x10ffff)) return ''
  const value = points.map((point) => String.fromCodePoint(point)).join('')
  const canonical = emojiPresentation.get(value.replace(/\uFE0F/g, ''))
  if (canonical === undefined) return value
  // Only restore selectors omitted at canonical positions; never move or remove input characters.
  const input = Array.from(value)
  let index = 0
  for (const character of canonical) {
    if (character === input[index]) index++
    else if (character !== '\uFE0F') return value
  }
  return index === input.length ? canonical : value
}
