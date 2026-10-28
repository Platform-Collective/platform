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
 * Restore emoji presentation for legacy icon codepoints using a compact lookup generated from the picker's emoji dataset.
 * Unknown sequences and explicit text presentation are preserved.
 * @public
 */
export function getEmojiFromCodePoints (icon: number | number[]): string {
  const value = Array.isArray(icon) ? String.fromCodePoint(...icon) : String.fromCodePoint(icon)
  return emojiPresentation.get(value.replace(/\uFE0F/g, '')) ?? value
}
