// SPDX-License-Identifier: EPL-2.0

import { type DiffFile, type DiffHunk, DiffLineType } from '@hcengineering/diffview'
import { parseDiff } from '@hcengineering/diffview-resources'

/** Parses a stored diff for thread snippets. No change limit, so a file too large for the diff view keeps its hunks. */
export function parsePatch (patch: string): DiffFile[] {
  return parseDiff(patch, { maxChanges: null })
}

// The hunk's text cut after the commented line; '' when the hunk does not hold it
function hunkIn (hunk: DiffHunk, line: number | null, oldLine: number | null): string {
  const text = [hunk.header]
  for (const diffLine of hunk.lines) {
    text.push(diffLine.prefix + diffLine.content)
    const isNewLine = line !== null && diffLine.type !== DiffLineType.DELETE && diffLine.newNumber === line
    const isOldLine =
      line === null && oldLine !== null && diffLine.type !== DiffLineType.INSERT && diffLine.oldNumber === oldLine
    if (isNewLine || isOldLine) return text.join('\n')
  }
  return ''
}

/**
 * The hunk of a parsed diff (parsePatch) that holds a commented line, cut after that line. `line` counts
 * on the new side; `oldLine` finds removed lines, which have no new number. '' when the diff does not hold the line.
 */
export function findHunk (files: DiffFile[], path: string, line: number | null, oldLine: number | null): string {
  for (const file of files) {
    if (file.fileName !== path) continue
    for (const hunk of file.hunks) {
      const text = hunkIn(hunk, line, oldLine)
      if (text !== '') return text
    }
  }
  return ''
}
