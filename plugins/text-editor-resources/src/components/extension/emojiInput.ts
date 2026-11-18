// SPDX-License-Identifier: EPL-2.0
import { type ExtendedEmoji, isCustomEmoji } from '@hcengineering/emoji'
import { type ExtendedRegExpMatchArray, type Range, type SingleCommands } from '@tiptap/core'
import { type ResolvedPos } from '@tiptap/pm/model'
import { type EditorState } from '@tiptap/pm/state'

const invalidMarks = ['link']

export function isValidEmojiPosition ($pos: ResolvedPos): boolean {
  const marks = $pos.marks()
  if (marks.some((p) => invalidMarks.includes(p.type.name))) {
    return false
  }
  return true
}

/**
 * Start of the document range an emoji input rule replaces.
 *
 * `range` is the input rule range: it covers the part of `fullMatch` that is already in the document,
 * the rest of `fullMatch` is the text being inserted. `fullMatch` is the leading whitespace (kept)
 * followed by `emoji`. Depending on how the emoji arrives, the inserted text is its last character
 * (typing), the whole emoji (insertText of a surrogate pair) or nothing at all (the rule re-runs after
 * compositionend, which is how the Windows emoji picker inserts in Chromium). Assuming a single inserted
 * character would cut a surrogate pair in half and leave a lone surrogate (shown as U+FFFD) before the emoji.
 */
export function emojiRangeStart (range: Range, fullMatch: string, emoji: string): number {
  return Math.min(range.to, range.from + fullMatch.length - emoji.length)
}

export function handleEmoji (
  state: EditorState,
  range: Range,
  match: ExtendedRegExpMatchArray,
  commands: SingleCommands,
  getEmojiFunction: (key: string | undefined) => ExtendedEmoji | string | undefined
): void {
  const $from = state.doc.resolve(range.from)
  if (!isValidEmojiPosition($from)) {
    return
  }

  const fullMatch = match[0]
  const emojiString = match.pop()
  if (emojiString === undefined) return
  const emoji = getEmojiFunction(emojiString)
  if (emoji === undefined) return
  // input rule matches keep their leading whitespace, paste rule matches are the emoji only
  if (match.length > 0) range.from = emojiRangeStart(range, fullMatch, emojiString)

  commands.insertContentAt(range, [getEmojiNodeContent(emoji)])
}

export function getEmojiNodeContent (emoji: ExtendedEmoji | string): Record<string, any> {
  if (typeof emoji === 'string' || !isCustomEmoji(emoji)) {
    return {
      type: 'emoji',
      attrs: {
        emoji: typeof emoji === 'string' ? emoji : emoji.emoji,
        kind: 'unicode'
      }
    }
  }
  return {
    type: 'emoji',
    attrs: {
      emoji: `:${emoji.shortcode}:`,
      kind: 'image',
      image: emoji.image
    }
  }
}
