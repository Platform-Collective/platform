// SPDX-License-Identifier: EPL-2.0

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** One file of a unified diff: its 'diff --git' line and the lines up to the next file. */
export interface PatchFile {
  header: string
  lines: string[]
}

/** The files of a unified diff, in order; lines before the first 'diff --git' are dropped. */
export function splitPatchFiles (patch: string): PatchFile[] {
  const files: PatchFile[] = []
  let current: PatchFile | undefined
  for (const text of patch.split('\n')) {
    if (text.startsWith('diff --git ')) {
      current = { header: text, lines: [] }
      files.push(current)
      continue
    }
    current?.lines.push(text)
  }
  return files
}

// The hunk of one file's lines that holds the commented line, cut after it; '' when it is not there
function hunkIn (lines: string[], line: number | null, oldLine: number | null): string {
  let hunk: string[] = []
  let oldNo = 0
  let newNo = 0
  for (const text of lines) {
    const header = HUNK_HEADER.exec(text)
    if (header !== null) {
      hunk = [text]
      oldNo = Number(header[1])
      newNo = Number(header[2])
      continue
    }
    // File headers ('index', '---', '+++') come before the first hunk
    if (hunk.length === 0) continue
    hunk.push(text)
    const kind = text[0]
    // '\ No newline at end of file'
    if (kind === '\\') continue
    if (line !== null && kind !== '-' && newNo === line) return hunk.join('\n')
    if (line === null && oldLine !== null && kind !== '+' && oldNo === oldLine) return hunk.join('\n')
    if (kind !== '+') oldNo++
    if (kind !== '-') newNo++
  }
  return ''
}

/**
 * The hunk of a split diff that holds a commented line, cut after that line. `line` counts on the new
 * side; `oldLine` finds removed lines, which have no new number. '' when the diff does not hold the line.
 */
export function findHunk (files: PatchFile[], path: string, line: number | null, oldLine: number | null): string {
  for (const file of files) {
    if (!file.header.endsWith(` b/${path}`)) continue
    const hunk = hunkIn(file.lines, line, oldLine)
    if (hunk !== '') return hunk
  }
  return ''
}
