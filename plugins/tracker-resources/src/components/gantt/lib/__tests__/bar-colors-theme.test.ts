// SPDX-License-Identifier: EPL-2.0

import { readFileSync, readdirSync } from 'fs'
import { join, resolve } from 'path'

// An undefined CSS variable without fallback is invalid at computed-value
// time: an SVG fill then falls back to black (e.g. a black bar, or black
// labels in the dark theme).
describe('gantt theme variables', () => {
  const root = resolve(__dirname, '../../../../../../..')
  const stylesDir = join(root, 'packages/theme/styles')
  const ganttDir = resolve(__dirname, '../..')
  const defined = new Set(
    readdirSync(stylesDir)
      .filter((name) => name.endsWith('.scss'))
      .flatMap((name) =>
        Array.from(readFileSync(join(stylesDir, name), 'utf8').matchAll(/(--[\w-]+)\s*:/g), (m) => m[1])
      )
  )

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path)
      return /\.(ts|svelte)$/.test(entry.name) ? [path] : []
    })
  }

  it('only references theme variables that exist', () => {
    const undefinedVars = sourceFiles(ganttDir).flatMap((file) =>
      Array.from(readFileSync(file, 'utf8').matchAll(/var\((--[\w-]+)\)/g), (m) => m[1])
        .filter((name) => !defined.has(name))
        .map((name) => `${file.slice(ganttDir.length + 1)}: ${name}`)
    )

    expect(undefinedVars).toEqual([])
  })
})
