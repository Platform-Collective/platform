// SPDX-License-Identifier: EPL-2.0

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * The hunk of a unified diff that holds a commented line, cut after that line. `line` counts on the new
 * side; `oldLine` finds removed lines, which have no new number. '' when the diff does not hold the line.
 */
export function extractHunk (patch: string, path: string, line: number | null, oldLine: number | null): string {
  let inFile = false
  let hunk: string[] = []
  let oldNo = 0
  let newNo = 0
  for (const text of patch.split('\n')) {
    if (text.startsWith('diff --git ')) {
      inFile = text.endsWith(` b/${path}`)
      hunk = []
      continue
    }
    if (!inFile) continue
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
