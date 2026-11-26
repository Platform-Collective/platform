// SPDX-License-Identifier: EPL-2.0

import { MarkupMarkType, MarkupNodeType } from '@hcengineering/text-core'
import type { MarkupMark, MarkupNode } from '@hcengineering/text-core'
import { markdownToMarkup, markupToMarkdown } from '..'

function inlineContent (content: MarkupNode[]): MarkupNode {
  return {
    type: MarkupNodeType.doc,
    content: [{ type: MarkupNodeType.paragraph, content }]
  }
}

function inlineCode (text: string): MarkupNode {
  return inlineContent([{ type: MarkupNodeType.text, text, marks: [{ type: MarkupMarkType.code, attrs: {} }] }])
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

  const code: MarkupMark = { type: MarkupMarkType.code, attrs: {} }
  const bold: MarkupMark = { type: MarkupMarkType.bold }
  const italic: MarkupMark = { type: MarkupMarkType.em }
  const link: MarkupMark = { type: MarkupMarkType.link, attrs: { href: 'https://example.com' } }
  const codeRuns: Array<{
    name: string
    nodes: Array<{ text: string, marks: MarkupMark[] }>
    markdown: string
  }> = [
    {
      name: 'the reviewer example with partial bold',
      nodes: [
        { text: 'a`b', marks: [code, bold] },
        { text: 'c', marks: [code] }
      ],
      markdown: '``a`bc``'
    },
    {
      name: 'the reviewer example with bold in the last node',
      nodes: [
        { text: 'a`b', marks: [code] },
        { text: 'c', marks: [code, bold] }
      ],
      markdown: '``a`bc``'
    },
    {
      name: 'a link inside code',
      nodes: [
        { text: 'a``b', marks: [code, link] },
        { text: 'c', marks: [code] }
      ],
      markdown: '```a``bc```'
    },
    {
      name: 'three nodes with mixed marks and backticks in the middle',
      nodes: [
        { text: 'a', marks: [code, bold] },
        { text: 'b```c', marks: [code, link] },
        { text: 'd', marks: [code] }
      ],
      markdown: '````ab```cd````'
    },
    {
      name: 'backticks only in the last node',
      nodes: [
        { text: 'a', marks: [code] },
        { text: 'b``c', marks: [code, bold] }
      ],
      markdown: '```ab``c```'
    },
    {
      name: 'code staying open across nested marks until paragraph end',
      nodes: [
        { text: 'a`b', marks: [code, bold] },
        { text: 'c', marks: [code, italic] }
      ],
      markdown: '``a`bc``'
    },
    {
      name: 'a single node with a nested mark at paragraph end',
      nodes: [{ text: 'a`b', marks: [code, bold] }],
      markdown: '``a`b``'
    },
    {
      name: 'a leading backtick needing padding on both sides',
      nodes: [
        { text: '`a', marks: [bold, code] },
        { text: 'b', marks: [code] }
      ],
      markdown: '`` `ab ``'
    },
    {
      name: 'a trailing backtick needing padding on both sides',
      nodes: [
        { text: 'a', marks: [code, link] },
        { text: 'b`', marks: [code] }
      ],
      markdown: '`` ab` ``'
    },
    {
      name: 'an internal backtick at an outer-mark boundary',
      nodes: [
        { text: 'a`', marks: [bold, code] },
        { text: 'b', marks: [code] }
      ],
      markdown: '``a`b``'
    },
    {
      name: 'a backtick run crossing a node boundary',
      nodes: [
        { text: 'a``', marks: [code, bold] },
        { text: '`b', marks: [code] }
      ],
      markdown: '````a```b````'
    },
    {
      name: 'spaces at both ends of the whole run',
      nodes: [
        { text: ' a', marks: [bold, code] },
        { text: 'b ', marks: [code, link] }
      ],
      markdown: '`  ab  `'
    }
  ]

  describe.each(['', ' after'])('followed by %j', (suffix) => {
    it.each(codeRuns)('serializes one code span for $name', ({ nodes, markdown: expectedMarkdown }) => {
      const content: MarkupNode[] = nodes.map((node) => ({ type: MarkupNodeType.text, ...node }))
      const markup = inlineContent(content)
      const expected = inlineCode(nodes.map((node) => node.text).join(''))
      if (suffix !== '') {
        const after: MarkupNode = { type: MarkupNodeType.text, text: suffix, marks: [] }
        content.push(after)
        expected.content?.[0].content?.push(after)
      }
      const original = JSON.stringify(markup)

      const markdown = markupToMarkdown(markup)

      expect(markdown).toBe(expectedMarkdown + suffix)
      expect(markdownToMarkup(markdown)).toEqual(expected)
      expect(JSON.stringify(markup)).toBe(original)
    })
  })

  it.each([' between ', ' '])('keeps separate code runs independent across %j', (separator) => {
    const between: MarkupNode = { type: MarkupNodeType.text, text: separator, marks: [] }
    const after: MarkupNode = { type: MarkupNodeType.text, text: ' after', marks: [] }
    const markup = inlineContent([
      { type: MarkupNodeType.text, text: '`a````', marks: [code, bold] },
      between,
      { type: MarkupNodeType.text, text: 'b`c', marks: [code, link] },
      { type: MarkupNodeType.text, text: 'd', marks: [code] },
      after
    ])

    const markdown = markupToMarkdown(markup)

    expect(markdown).toBe('````` `a```` `````' + separator + '``b`cd`` after')
    expect(markdownToMarkup(markdown)).toEqual(
      inlineContent([
        { type: MarkupNodeType.text, text: '`a````', marks: [code] },
        between,
        { type: MarkupNodeType.text, text: 'b`cd', marks: [code] },
        after
      ])
    )
  })

  const nonTextNodes: Array<{
    name: string
    node: MarkupNode
    markdown: string
    parsed: MarkupNode
  }> = [
    {
      name: 'hard break',
      node: { type: MarkupNodeType.hard_break, marks: [code] },
      markdown: '\\\n',
      parsed: { type: MarkupNodeType.hard_break, content: [] }
    },
    {
      name: 'emoji',
      node: { type: MarkupNodeType.emoji, attrs: { emoji: '🙂' }, marks: [code] },
      markdown: '🙂',
      // Markdown represents emoji as plain text.
      parsed: { type: MarkupNodeType.text, text: '🙂', marks: [] }
    },
    {
      name: 'mention',
      node: {
        type: MarkupNodeType.reference,
        attrs: { id: 'person-1', objectclass: 'contact:class:Person', label: 'L' },
        marks: [code]
      },
      markdown: '[L](ref://?_class=contact%3Aclass%3APerson&_id=person-1&label=L)',
      parsed: {
        type: MarkupNodeType.reference,
        attrs: { id: 'person-1', objectclass: 'contact:class:Person', label: 'L' },
        content: [{ type: MarkupNodeType.text, text: 'L', marks: [] }]
      }
    }
  ]

  describe.each(nonTextNodes)('code-marked $name inside a selection', ({ node, markdown: separator, parsed }) => {
    describe.each(['', ' after'])('followed by %j', (suffix) => {
      it.each([
        { before: ['a', 'b'], after: ['c', 'd``e'], beforeMarkdown: '`ab`', afterMarkdown: '```cd``e```' },
        { before: ['a`', 'b'], after: ['c', 'd'], beforeMarkdown: '``a`b``', afterMarkdown: '`cd`' }
      ])('keeps independent fences for $before and $after', ({ before, after, beforeMarkdown, afterMarkdown }) => {
        const textNode = (text: string): MarkupNode => ({ type: MarkupNodeType.text, text, marks: [code] })
        const trailing: MarkupNode[] = suffix === '' ? [] : [{ type: MarkupNodeType.text, text: suffix, marks: [] }]
        const markup = inlineContent([...before.map(textNode), node, ...after.map(textNode), ...trailing])
        const original = JSON.stringify(markup)

        const markdown = markupToMarkdown(markup)

        expect(markdown).toBe(beforeMarkdown + separator + afterMarkdown + suffix)
        expect(markdownToMarkup(markdown)).toEqual(
          inlineContent([textNode(before.join('')), parsed, textNode(after.join('')), ...trailing])
        )
        expect(JSON.stringify(markup)).toBe(original)
      })
    })
  })

  it('does not reuse an earlier code fence for a lone code-marked emoji', () => {
    const markup = inlineContent([
      { type: MarkupNodeType.text, text: 'a``b', marks: [code] },
      { type: MarkupNodeType.text, text: ' between ', marks: [] },
      { type: MarkupNodeType.emoji, attrs: { emoji: '🙂' }, marks: [code] }
    ])

    const markdown = markupToMarkdown(markup)

    expect(markdown).toBe('```a``b``` between 🙂')
    expect(markdownToMarkup(markdown)).toEqual(
      inlineContent([
        { type: MarkupNodeType.text, text: 'a``b', marks: [code] },
        { type: MarkupNodeType.text, text: ' between 🙂', marks: [] }
      ])
    )
  })

  it.each([bold, link])('preserves a shared outer $type mark around the whole code span', (outer) => {
    const markup = inlineContent([
      { type: MarkupNodeType.text, text: '`a', marks: [outer, code, italic] },
      { type: MarkupNodeType.text, text: 'b`', marks: [outer, code] }
    ])

    const markdown = markupToMarkdown(markup)

    expect(markdown).toBe(outer === bold ? '**`` `ab` ``**' : '[`` `ab` ``](https://example.com)')
    const parsed = markdownToMarkup(markdown)
    expect(parsed.content?.[0].content).toHaveLength(1)
    expect(parsed.content?.[0].content?.[0].text).toBe('`ab`')
    expect(parsed.content?.[0].content?.[0].marks).toEqual(
      expect.arrayContaining([code, expect.objectContaining(outer)])
    )
    expect(parsed.content?.[0].content?.[0].marks).toHaveLength(2)
  })

  it('preserves whitespace inside code enclosed by a shared outer mark', () => {
    const markup = inlineContent([
      { type: MarkupNodeType.text, text: ' a', marks: [bold, code, italic] },
      { type: MarkupNodeType.text, text: 'b ', marks: [bold, code] }
    ])

    const markdown = markupToMarkdown(markup)

    expect(markdown).toBe('**`  ab  `**')
    expect(markdownToMarkup(markdown)).toEqual(
      inlineContent([{ type: MarkupNodeType.text, text: ' ab ', marks: [{ ...bold, attrs: { marker: '**' } }, code] }])
    )
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
