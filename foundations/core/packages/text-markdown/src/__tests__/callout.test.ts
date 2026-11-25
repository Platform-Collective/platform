// SPDX-License-Identifier: EPL-2.0

import { MarkupNodeType, MarkupMarkType, type MarkupNode } from '@hcengineering/text-core'
import { markdownToMarkup, markupToMarkdown } from '..'

const paragraph = (text?: string): MarkupNode => ({
  type: MarkupNodeType.paragraph,
  content: text === undefined ? [] : [{ type: MarkupNodeType.text, text }]
})

describe('callout Markdown conversion', () => {
  it('round-trips GitHub-style notes without losing block content', () => {
    const doc: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.callout,
          attrs: { kind: 'info', emoji: null },
          content: [
            {
              type: MarkupNodeType.paragraph,
              content: [{ type: MarkupNodeType.text, text: 'Formatted', marks: [{ type: MarkupMarkType.bold }] }]
            },
            paragraph('Second paragraph'),
            {
              type: MarkupNodeType.bullet_list,
              content: [{ type: MarkupNodeType.list_item, content: [paragraph('Item')] }]
            },
            {
              type: MarkupNodeType.code_block,
              attrs: { language: 'ts' },
              content: [{ type: MarkupNodeType.text, text: 'first\n\nsecond' }]
            },
            { type: MarkupNodeType.callout, attrs: { kind: 'info', emoji: null }, content: [paragraph('Nested')] }
          ]
        }
      ]
    }
    const markdown = markupToMarkdown(doc)
    expect(markdown).toContain('> [!NOTE]\n>\n> **Formatted**')
    expect(markdown).not.toContain('<div data-type="callout"')
    expect(markdownToMarkup(markdown)).toMatchObject(doc)
    expect(markupToMarkdown(markdownToMarkup(markdown))).toBe(markdown)
  })

  it('preserves every quote prefix when a nested callout starts with a heading', () => {
    const doc: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.callout,
          content: [
            {
              type: MarkupNodeType.callout,
              content: [
                {
                  type: MarkupNodeType.heading,
                  attrs: { level: 1, marker: '#' },
                  content: [{ type: MarkupNodeType.text, text: 'Inner heading' }]
                },
                paragraph('Inner body')
              ]
            },
            paragraph('Outer body')
          ]
        },
        paragraph('After')
      ]
    }
    const markdown = markupToMarkdown(doc)
    expect(markdown).toContain('> > [!NOTE]\n> >\n> > # Inner heading')
    expect(markdownToMarkup(markdown)).toMatchObject(doc)
  })

  it('does not add an empty marker paragraph before a list', () => {
    const doc: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.callout,
          content: [
            {
              type: MarkupNodeType.bullet_list,
              content: [{ type: MarkupNodeType.list_item, content: [paragraph('Item')] }]
            }
          ]
        }
      ]
    }
    const restored = markdownToMarkup(markupToMarkdown(doc))
    expect(restored).toMatchObject(doc)
    expect(restored.content?.[0].content?.map((node) => node.type)).toEqual([MarkupNodeType.bullet_list])
  })

  it.each([
    ['---', MarkupNodeType.horizontal_rule],
    ['Heading\n---', MarkupNodeType.heading],
    ['3. Item', MarkupNodeType.ordered_list]
  ])('preserves a callout starting with %j', (firstBlock, blockType) => {
    const block = markdownToMarkup(firstBlock).content?.[0]
    expect(block?.type).toBe(blockType)
    if (block === undefined) throw new Error('Expected the first Markdown block')

    const doc: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [{ type: MarkupNodeType.callout, content: [block, paragraph('Inside')] }, paragraph('After')]
    }

    const markdown = markupToMarkdown(doc)
    const restored = markdownToMarkup(markdown)
    expect(restored).toMatchObject(doc)
    expect(restored.content?.[0].content?.map((node) => node.type)).toEqual([blockType, MarkupNodeType.paragraph])
    expect(markdown).toContain('> [!NOTE]\n>\n')
  })

  it('accepts a GitHub-style note separately from following Markdown and ordinary blockquotes', () => {
    const doc = markdownToMarkup('> [!NOTE]\n> Note\n>\n> Second\n\nAfter\n\n> Quote')
    expect(doc.content?.map((node) => node.type)).toEqual(['callout', 'paragraph', 'blockquote'])
    expect(doc.content?.[0].attrs).toEqual({ kind: 'info', emoji: null })
    expect(doc.content?.[0].content?.map((node) => node.content?.[0]?.text)).toEqual(['Note', 'Second'])
    expect(markdownToMarkup('> Quote').content?.[0].type).toBe(MarkupNodeType.blockquote)
  })

  it('continues to accept tagged HTML callouts', () => {
    const doc = markdownToMarkup('<div data-type="callout"><p>Note</p></div>\n\nAfter')
    expect(doc.content?.map((node) => node.type)).toEqual(['callout', 'paragraph'])
  })

  it('uses tagged HTML when a custom emoji needs to be preserved', () => {
    const doc: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.callout,
          attrs: { kind: 'info', emoji: '💡' },
          content: [{ ...paragraph('Note'), attrs: { textAlign: null } }]
        }
      ]
    }
    const markdown = markupToMarkdown(doc)
    expect(markdown).toContain('<div data-type="callout"')
    expect(markdownToMarkup(markdown)).toEqual(doc)
  })

  it('preserves literal HTML-looking text and real formatting with a custom emoji', () => {
    const doc: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.callout,
          attrs: { kind: 'info', emoji: '💡' },
          content: [
            {
              ...paragraph('Use <b>literal</b> & '),
              attrs: { textAlign: null },
              content: [
                { type: MarkupNodeType.text, text: 'Use <b>literal</b> & ' },
                { type: MarkupNodeType.text, text: 'bold', marks: [{ type: MarkupMarkType.bold }] }
              ]
            }
          ]
        }
      ]
    }
    const markdown = markupToMarkdown(doc)
    expect(markdown).toContain('Use &lt;b&gt;literal&lt;/b&gt; &amp; <strong>bold</strong>')
    const restored = markdownToMarkup(markdown)
    expect(restored.content?.[0].attrs).toEqual({ kind: 'info', emoji: '💡' })
    const content = restored.content?.[0].content?.[0].content ?? []
    expect(content.map((node) => node.text ?? '').join('')).toBe('Use <b>literal</b> & bold')
    expect(
      content
        .filter((node) => node.marks?.some((mark) => mark.type === MarkupMarkType.bold) !== true)
        .map((node) => node.text ?? '')
        .join('')
    ).toBe('Use <b>literal</b> & ')
  })

  it('matches sequential and nested callouts without rescanning the token array', () => {
    const markdown = Array.from({ length: 32 }, (_, index) => `> [!NOTE]\n> Note ${index}`).join('\n\n')
    const findIndex = jest.spyOn(Array.prototype, 'findIndex')
    try {
      const doc = markdownToMarkup(`${markdown}\n\n> Outer\n> > [!NOTE]\n> > Nested`)
      expect(doc.content).toHaveLength(33)
      expect(doc.content?.[32].content?.[1].type).toBe(MarkupNodeType.callout)
      expect(findIndex).not.toHaveBeenCalled()
    } finally {
      findIndex.mockRestore()
    }
  })

  it('defaults missing attributes and preserves an empty callout', () => {
    const doc: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.callout,
          content: [paragraph()]
        }
      ]
    }
    expect(markdownToMarkup(markupToMarkdown(doc)).content?.[0]).toEqual({
      ...doc.content?.[0],
      attrs: { kind: 'info', emoji: null }
    })
  })
})
