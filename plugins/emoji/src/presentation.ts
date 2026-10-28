// SPDX-License-Identifier: EPL-2.0

import unicodeEmoji from 'emojibase-data/meta/unicode.json'

const emojiPresentation = new Map<string, string>()
for (const emoji of unicodeEmoji) {
  if (!emoji.includes('\uFE0F')) continue
  const key = emoji.replace(/\uFE0F/g, '')
  const current = emojiPresentation.get(key)
  if (current === undefined || emoji.length > current.length) {
    emojiPresentation.set(key, emoji)
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
 * Restore emoji presentation for legacy icon codepoints using the picker's emoji dataset.
 * Unknown sequences and explicit text presentation are preserved.
 * @public
 */
export function getEmojiFromCodePoints (icon: number | number[]): string {
  const value = Array.isArray(icon) ? String.fromCodePoint(...icon) : String.fromCodePoint(icon)
  return emojiPresentation.get(value.replace(/\uFE0F/g, '')) ?? value
}
