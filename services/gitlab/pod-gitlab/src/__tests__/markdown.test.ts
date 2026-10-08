// SPDX-License-Identifier: EPL-2.0
import type { WorkspaceUuid } from '@hcengineering/core'
import { isMarkdownsEquals } from '@hcengineering/text-markdown'
import { createMarkdownConverter, markdownUrls } from '../markdown'

const md = createMarkdownConverter({ refUrl: 'ref://', imageUrl: 'http://front/files?file=' })

describe('markdown converter', () => {
  it.each([
    'plain text',
    '**bold** and `code`',
    '- [ ] todo\n- [x] done',
    '# Title\n\nParagraph with a [link](https://example.com)',
    '<details><summary>More</summary>\n\nHidden text\n</details>',
    '| a | b |\n|---|---|\n| 1 | 2 |'
  ])('round-trips %p', (text) => {
    expect(isMarkdownsEquals(text, md.toMarkdown(md.toMarkup(text)))).toBe(true)
  })

  it('maps empty and missing markdown to empty markup', () => {
    expect(md.toMarkup(null)).toBe('')
    expect(md.toMarkup(undefined)).toBe('')
    expect(md.toMarkup('')).toBe('')
  })

  it('is deterministic, so markup comparisons are stable', () => {
    expect(md.toMarkup('Body 1')).toBe(md.toMarkup('Body 1'))
  })

  it('builds workspace links for references and files', () => {
    expect(markdownUrls('http://front/', 'ws1' as WorkspaceUuid)).toEqual({
      refUrl: 'http://front/browse/?workspace=ws1',
      imageUrl: 'http://front/files?workspace=ws1&file='
    })
  })
})
