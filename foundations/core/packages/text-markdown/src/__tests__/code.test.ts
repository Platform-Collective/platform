// SPDX-License-Identifier: EPL-2.0

import { MarkupMarkType, MarkupNodeType } from '@hcengineering/text-core'
import type { MarkupNode } from '@hcengineering/text-core'
import { markdownToMarkup, markupToMarkdown } from '..'

function inlineCode (text: string): MarkupNode {
  return {
    type: MarkupNodeType.doc,
    content: [
      {
        type: MarkupNodeType.paragraph,
        content: [{ type: MarkupNodeType.text, text, marks: [{ type: MarkupMarkType.code, attrs: {} }] }]
      }
    ]
  }
}

describe('inline code delimiters', () => {
  it.each([
    ['plain', '`plain`'],
    ['a`b', '``a`b``'],
    ['a``b`c', '```a``b`c```'],
    ['`ls`', '`` `ls` ``'],
    ['`start', '`` `start ``'],
    ['end`', '`` end` ``'],
    ['``', '``` `` ```'],
    [' leading', '` leading`'],
    ['trailing ', '`trailing `'],
    [' both ', '`  both  `'],
    ['  both  ', '`   both   `'],
    [' ', '` `'],
    ['  ', '`  `']
  ])('preserves %j', (text, expectedMarkdown) => {
    const markup = inlineCode(text)
    const markdown = markupToMarkdown(markup)

    expect(markdown).toBe(expectedMarkdown)
    expect(markdownToMarkup(markdown)).toEqual(markup)
  })

  it('uses one delimiter pair for adjacent text nodes with the same code mark', () => {
    const markup = inlineCode('`a``b ')
    const content = markup.content?.[0].content
    content?.splice(
      0,
      1,
      ...['`a`', '`b '].map((text) => ({
        type: MarkupNodeType.text,
        text,
        marks: [{ type: MarkupMarkType.code, attrs: {} }]
      }))
    )

    const markdown = markupToMarkdown(markup)

    expect(markdown).toBe('``` `a``b  ```')
    expect(markdownToMarkup(markdown)).toEqual(inlineCode('`a``b '))
    expect(content).toHaveLength(2)
  })

  it('closes code delimiters before unmarked text', () => {
    const markup = inlineCode('a`b')
    markup.content?.[0].content?.push({ type: MarkupNodeType.text, text: ' after', marks: [] })

    const markdown = markupToMarkdown(markup)

    expect(markdown).toBe('``a`b`` after')
    expect(markdownToMarkup(markdown)).toEqual(markup)
  })
})

describe.each([MarkupNodeType.code_block, MarkupNodeType.mermaid])('%s fences', (type) => {
  it.each([
    ['plain code', 3],
    ['before\n```\nafter', 4],
    ['before\n`````\nafter', 6],
    ['before\n   ````\nafter', 5]
  ])('preserves %j', (text, fenceLength) => {
    const language = type === MarkupNodeType.mermaid ? 'mermaid' : 'typescript'
    const markup: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type,
          attrs: { language },
          content: [{ type: MarkupNodeType.text, text, marks: [] }]
        }
      ]
    }
    const markdown = markupToMarkdown(markup)
    const fence = '`'.repeat(fenceLength)

    expect(markdown).toBe(fence + language + '\n' + text + '\n' + fence)
    expect(markdownToMarkup(markdown)).toEqual(markup)
  })
})
