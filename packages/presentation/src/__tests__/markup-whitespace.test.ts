// SPDX-License-Identifier: EPL-2.0

import { readFileSync } from 'fs'
import { join } from 'path'

const COMPONENTS = join(__dirname, '..', 'components')

const source = (relative: string): string => readFileSync(join(COMPONENTS, relative), 'utf8')

describe('saved markup whitespace', () => {
  it.each(['HTMLViewer.svelte', 'MessageViewer.svelte'])('%s preserves whitespace except in previews', (file) => {
    expect(source(file)).toContain('<div class="text-markup-view" style:white-space={preview ? null : \'pre-wrap\'}>')
  })

  it('renders text runs without per-fragment wrappers', () => {
    const content = source('markup/NodeContent.svelte')
    const textBranch = content.slice(
      content.indexOf('{:else if node.type === MarkupNodeType.text}'),
      content.indexOf('{:else if node.type === MarkupNodeType.emoji}')
    )

    expect(textBranch).toContain('{node.text}')
    expect(textBranch).toContain('{textOrEmoji}')
    expect(textBranch).not.toContain('<span style:white-space')
  })
})
