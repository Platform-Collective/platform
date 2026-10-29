/** @jest-environment jsdom */

//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { getSchema } from '@tiptap/core'
import { DOMParser, DOMSerializer, Schema } from '@tiptap/pm/model'
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import Underline from '@tiptap/extension-underline'
import StarterKit from '@tiptap/starter-kit'

import { normalizeSlackPastedHTML, PasteTextAsMarkdownPlugin } from '../smartPaste'
import { normalizeWordPastedHTML } from '../word-paste'
import { wordDesktopHTML } from './fixtures/word-desktop'

jest.mock('@hcengineering/text', () => ({
  __esModule: true,
  MarkupNodeType: {
    doc: 'doc',
    text: 'text',
    paragraph: 'paragraph',
    heading: 'heading',
    code_block: 'codeBlock',
    bullet_list: 'bulletList',
    list_item: 'listItem',
    table: 'table',
    todoList: 'todoList',
    ordered_list: 'orderedList',
    reference: 'reference',
    image: 'image',
    mermaid: 'mermaid'
  },
  MarkupMarkType: {
    bold: 'bold',
    em: 'em',
    code: 'code',
    link: 'link'
  }
}))

jest.mock('@hcengineering/text-markdown', () => ({
  __esModule: true,
  markdownToMarkup: (markdown: string) => ({
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: markdown.trim().length > 0 ? markdown.trim() : 'title' }]
      }
    ]
  })
}))

jest.mock('../../codeSnippets/codeblock', () => ({
  __esModule: true,
  CodeBlockHighlighExtension: { name: 'codeBlock' }
}))

function makeSchema (): Schema {
  return new Schema({
    nodes: {
      doc: { content: 'block+' },
      text: { group: 'inline' },
      heading: {
        group: 'block',
        content: 'inline*',
        attrs: { level: { default: 1 } },
        toDOM: (node) => ['h' + node.attrs.level, 0],
        parseDOM: [
          { tag: 'h1', attrs: { level: 1 } },
          { tag: 'h2', attrs: { level: 2 } },
          { tag: 'h3', attrs: { level: 3 } }
        ]
      },
      paragraph: {
        group: 'block',
        content: 'inline*',
        toDOM: () => ['p', 0],
        parseDOM: [{ tag: 'p' }]
      },
      codeBlock: {
        group: 'block',
        content: 'text*',
        marks: '',
        attrs: { language: { default: null } },
        toDOM: () => ['pre', ['code', 0]],
        parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }]
      },
      mermaid: {
        group: 'block',
        content: 'text*',
        marks: '',
        attrs: { language: { default: 'mermaid' } },
        toDOM: () => ['div', { class: 'mermaid-diagram' }, ['code', 0]],
        parseDOM: [{ tag: 'div.mermaid-diagram', preserveWhitespace: 'full' }]
      }
    },
    marks: {}
  })
}

function makeClipboardData (data: { plain?: string, markdown?: string, types?: string[] }): any {
  const plain = data.plain ?? ''
  const markdown = data.markdown ?? ''
  const types = data.types ?? ['text/plain']
  return {
    types,
    getData: (t: string) => {
      if (t === 'text/plain') return plain
      if (t === 'text/markdown') return markdown
      return ''
    }
  } as any
}

describe('SmartPaste handlePaste ignore contexts', () => {
  it('ignores smart paste when selection is inside a codeBlock', () => {
    const schema = makeSchema()
    const doc = schema.node('doc', undefined, [
      schema.node('codeBlock', { language: 'mermaid' }, schema.text('graph TD\nA-->B'))
    ])
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 2)
    })

    const plugin = PasteTextAsMarkdownPlugin()
    const handled = (plugin.props as any).handlePaste(
      { state, dispatch: jest.fn() },
      { clipboardData: makeClipboardData({ plain: '# title' }) },
      null
    )
    expect(handled).toBe(false)
  })

  it('ignores smart paste when selection is inside a mermaid block', () => {
    const schema = makeSchema()
    const doc = schema.node('doc', undefined, [schema.node('mermaid', undefined, schema.text('graph TD\nA-->B'))])
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 2)
    })

    const plugin = PasteTextAsMarkdownPlugin()
    const handled = (plugin.props as any).handlePaste(
      { state, dispatch: jest.fn() },
      { clipboardData: makeClipboardData({ plain: '# title' }) },
      null
    )
    expect(handled).toBe(false)
  })

  it('ignores smart paste when NodeSelection is a codeBlock', () => {
    const schema = makeSchema()
    const doc = schema.node('doc', undefined, [schema.node('codeBlock', undefined, schema.text('x'))])
    const state = EditorState.create({
      schema,
      doc,
      selection: NodeSelection.create(doc, 0)
    })

    const plugin = PasteTextAsMarkdownPlugin()
    const handled = (plugin.props as any).handlePaste(
      { state, dispatch: jest.fn() },
      { clipboardData: makeClipboardData({ plain: '# title' }) },
      null
    )
    expect(handled).toBe(false)
  })

  it('ignores smart paste when NodeSelection is a mermaid node', () => {
    const schema = makeSchema()
    const doc = schema.node('doc', undefined, [schema.node('mermaid', undefined, schema.text('x'))])
    const state = EditorState.create({
      schema,
      doc,
      selection: NodeSelection.create(doc, 0)
    })

    const plugin = PasteTextAsMarkdownPlugin()
    const handled = (plugin.props as any).handlePaste(
      { state, dispatch: jest.fn() },
      { clipboardData: makeClipboardData({ plain: '# title' }) },
      null
    )
    expect(handled).toBe(false)
  })
})

describe('SmartPaste handlePaste transform scenarios', () => {
  it('transforms plain text paste into markdown output in normal text selection', () => {
    const schema = makeSchema()
    const doc = schema.node('doc', undefined, [schema.node('paragraph', undefined, schema.text('hello'))])
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 2)
    })

    const dispatch = jest.fn()
    const plugin = PasteTextAsMarkdownPlugin()
    const handled = (plugin.props as any).handlePaste(
      { state, dispatch },
      { clipboardData: makeClipboardData({ plain: '# Title', types: ['text/plain'] }) },
      null
    )

    expect(handled).toBe(true)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('transforms when explicit markdown is present even with rich clipboard types', () => {
    const schema = makeSchema()
    const doc = schema.node('doc', undefined, [schema.node('paragraph', undefined, schema.text('hello'))])
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 2)
    })

    const dispatch = jest.fn()
    const plugin = PasteTextAsMarkdownPlugin()
    const handled = (plugin.props as any).handlePaste(
      { state, dispatch },
      {
        clipboardData: makeClipboardData({
          plain: 'fallback',
          markdown: '## Heading',
          types: ['text/html', 'text/markdown']
        })
      },
      null
    )

    expect(handled).toBe(true)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})

describe('normalizeSlackPastedHTML', () => {
  it.each([
    ['document', '<div data-stringify-type="paragraph">First line\nSecond line\nThird line</div>'],
    ['comment', '<span data-stringify-type="paragraph">First line\nSecond line\nThird line</span>']
  ])('preserves multi-line Slack snippets pasted into a %s', (_editor, html) => {
    const expected = html.replace(/\n/g, '<br>')

    expect(normalizeSlackPastedHTML(html)).toBe(expected)
  })

  it('does not treat a self-closing Slack element as surrounding content', () => {
    const html = '<br data-stringify-type="paragraph-break"/>\n<div>Outside Slack\ncontent</div>'

    expect(normalizeSlackPastedHTML(html)).toBe(html)
  })

  it('leaves non-Slack HTML unchanged', () => {
    const html = '<div>First line\nSecond line</div>'

    expect(normalizeSlackPastedHTML(html)).toBe(html)
  })
})

const pasteSchema = getSchema([StarterKit, Underline])

function parseWordHTML (html: string): ReturnType<DOMParser['parse']> {
  const container = document.createElement('div')
  const plugin = PasteTextAsMarkdownPlugin()
  if (plugin.props.transformPastedHTML === undefined) {
    throw new Error('Missing HTML paste transform')
  }
  container.innerHTML = plugin.props.transformPastedHTML.call(plugin, html, {} as unknown as EditorView)
  return DOMParser.fromSchema(pasteSchema).parse(container)
}

function listParagraph (text: string, level = 1, marker = '·', list = 'l0', instance = 'lfo1'): string {
  return `<p class="MsoListParagraph" style="mso-list:${list} level${level} ${instance}">
    <!--[if !supportLists]--><span style="mso-list:Ignore">${marker}<span>&nbsp;&nbsp;</span></span><!--[endif]-->
    ${text}</p>`
}

describe('Word clipboard HTML', () => {
  it('handles revealed conditionals, Symbol wrappers, private-use bullets and Office paragraph tags', () => {
    const container = document.createElement('div')
    container.innerHTML = normalizeWordPastedHTML(wordDesktopHTML)
    expect(container.querySelector('span[style*="Symbol"]')).toBeNull()
    expect(container.querySelector('[style*="Ignore"]')).toBeNull()

    const doc = parseWordHTML(wordDesktopHTML)
    expect(doc.childCount).toBe(1)
    const list = doc.child(0)
    expect(list.type.name).toBe('bulletList')
    expect(list.childCount).toBe(2)
    expect(list.child(0).child(0).textContent).toBe('First')
    expect(list.child(0).child(0).firstChild?.marks[0].type.name).toBe('bold')
    expect(list.child(0).child(1).type.name).toBe('bulletList')
    expect(list.child(0).child(1).textContent).toBe('Nested')
    expect(list.child(0).child(1).child(0).child(0).firstChild?.marks[0].type.name).toBe('italic')
    expect(list.child(1).textContent).toBe('Last')
    doc.check()

    container.replaceChildren(DOMSerializer.fromSchema(pasteSchema).serializeFragment(doc.content))
    expect(parseWordHTML(container.innerHTML).toJSON()).toEqual(doc.toJSON())
  })

  it('keeps content beside a marker inside a Symbol wrapper', () => {
    const html = `<p style="mso-list:l0 level1 lfo1"><span style="font-family:Symbol">
      <span style="mso-list:Ignore">·</span><b>Keep</b></span> content</p>`
    const doc = parseWordHTML(html)
    expect(doc.textContent).toBe('Keep content')
    expect(doc.child(0).child(0).child(0).firstChild?.marks[0].type.name).toBe('bold')
    doc.check()
  })

  it('keeps Google Docs headings, styled text and semantic lists', () => {
    const html = `<b id="docs-internal-guid-8608" style="font-weight:normal">
      <h2>Section</h2><p><span style="font-weight:700">Bold</span>
      <span style="font-style:italic">Italic</span><span style="text-decoration:underline">Underline</span></p>
      <ul><li><p>Item</p></li></ul></b>`
    expect(normalizeWordPastedHTML(html)).toBe(html)

    const doc = parseWordHTML(html)
    expect(doc.child(0).type.name).toBe('heading')
    expect(doc.child(0).attrs.level).toBe(2)
    for (const [text, mark] of [
      ['Bold', 'bold'],
      ['Italic', 'italic'],
      ['Underline', 'underline']
    ]) {
      const marks: string[] = []
      doc.child(1).descendants((node) => {
        if (node.text === text) marks.push(...node.marks.map((mark) => mark.type.name))
      })
      expect(marks).toEqual([mark])
    }
    expect(doc.child(2).type.name).toBe('bulletList')
    expect(doc.child(2).textContent).toBe('Item')
    doc.check()
  })

  it('converts Word titles to headings and keeps inline formatting', () => {
    const doc = parseWordHTML('<p class="MsoTitle"><b>Title</b></p><h2>Section</h2><p><em>Body</em></p>')
    expect(doc.child(0).type.name).toBe('heading')
    expect(doc.child(0).attrs.level).toBe(1)
    expect(doc.child(0).firstChild?.marks[0].type.name).toBe('bold')
    expect(doc.child(1).attrs.level).toBe(2)
    expect(doc.child(2).firstChild?.marks[0].type.name).toBe('italic')
  })

  it('groups Word bullet paragraphs and nests lists by their Word level', () => {
    const doc = parseWordHTML(listParagraph('<b>First</b>') + listParagraph('Nested', 2, 'o') + listParagraph('Second'))
    expect(doc.childCount).toBe(1)
    const list = doc.child(0)
    expect(list.type.name).toBe('bulletList')
    expect(list.childCount).toBe(2)
    expect(list.child(0).child(0).textContent).toBe('First')
    expect(list.child(0).child(0).firstChild?.marks[0].type.name).toBe('bold')
    expect(list.child(0).child(1).type.name).toBe('bulletList')
    expect(list.child(0).child(1).textContent).toBe('Nested')
    expect(list.child(1).textContent).toBe('Second')
    doc.check()

    // Schema serialization and reparse must retain the lists; this does not exercise application storage.
    const container = document.createElement('div')
    container.appendChild(DOMSerializer.fromSchema(pasteSchema).serializeFragment(doc.content))
    expect(parseWordHTML(container.innerHTML).toJSON()).toEqual(doc.toJSON())
  })

  it('preserves ordered list starts and separates different list instances', () => {
    const doc = parseWordHTML(
      listParagraph('Third', 1, '3.') +
        listParagraph('Fourth', 1, '4.') +
        listParagraph('Restart', 1, '1.', 'l0', 'lfo2')
    )
    expect(doc.childCount).toBe(2)
    expect(doc.child(0).type.name).toBe('orderedList')
    expect(doc.child(0).attrs.start).toBe(3)
    expect(doc.child(0).childCount).toBe(2)
    expect(doc.child(0).textContent).toBe('ThirdFourth')
    expect(doc.child(1).attrs.start).toBe(1)
  })

  it('keeps mixed nested lists and returns to the parent level', () => {
    const doc = parseWordHTML(
      listParagraph('First', 1, '1.') +
        listParagraph('<i>Nested</i>', 2) +
        listParagraph('Deeper', 3, '1.') +
        listParagraph('Second', 1, '2.')
    )
    const list = doc.child(0)
    expect(list.type.name).toBe('orderedList')
    expect(list.childCount).toBe(2)
    expect(list.child(1).textContent).toBe('Second')
    const nested = list.child(0).child(1)
    expect(nested.type.name).toBe('bulletList')
    expect(nested.child(0).child(0).firstChild?.marks[0].type.name).toBe('italic')
    expect(nested.child(0).child(1).type.name).toBe('orderedList')
    expect(nested.child(0).child(1).textContent).toBe('Deeper')
    doc.check()
  })

  it.each([1, 2, 3])('keeps same-level marker changes as sibling lists at level %s', (level) => {
    const ancestors = Array.from({ length: level - 1 }, (_, i) => listParagraph(`Parent ${i + 1}`, i + 1, '1.'))
    const doc = parseWordHTML(
      ancestors.join('') +
        listParagraph('Bullet', level) +
        listParagraph('Ordered', level, '3.') +
        listParagraph('Bullet again', level) +
        (level > 1 ? listParagraph('Back to parent', 1, '2.') : '')
    )
    let parent = doc
    for (let i = 1; i < level; i++) {
      const listIndex = i === 1 ? 0 : 1
      parent = parent.child(listIndex).child(0)
    }
    const offset = level === 1 ? 0 : 1
    expect(parent.childCount).toBe(offset + 3)
    expect(parent.child(offset).type.name).toBe('bulletList')
    expect(parent.child(offset).textContent).toBe('Bullet')
    expect(parent.child(offset + 1).type.name).toBe('orderedList')
    expect(parent.child(offset + 1).attrs.start).toBe(3)
    expect(parent.child(offset + 1).textContent).toBe('Ordered')
    expect(parent.child(offset + 2).type.name).toBe('bulletList')
    expect(parent.child(offset + 2).textContent).toBe('Bullet again')
    if (level > 1) expect(doc.child(0).child(1).textContent).toBe('Back to parent')
    doc.check()
  })

  it.each(['c.', 'C)', 'iii)', 'IV.'])('documents the default start for an explicit nondecimal marker %s', (marker) => {
    const doc = parseWordHTML(listParagraph('Item', 1, marker))
    expect(doc.child(0).type.name).toBe('orderedList')
    expect(doc.child(0).attrs.start).toBe(1)
    expect(doc.textContent).toBe('Item')
    doc.check()
  })

  it('uses the last number of multi-level decimal markers for nested list starts', () => {
    const doc = parseWordHTML(
      listParagraph('One', 1, '1.') +
        listParagraph('One one', 2, '1.1.') +
        listParagraph('One two', 2, '1.2.') +
        listParagraph('Two', 1, '2.') +
        listParagraph('Two one', 2, '2.1.')
    )
    expect(doc.childCount).toBe(1)
    const list = doc.child(0)
    expect(list.type.name).toBe('orderedList')
    expect(list.attrs.start).toBe(1)
    expect(list.childCount).toBe(2)
    const first = list.child(0).child(1)
    expect(first.type.name).toBe('orderedList')
    expect(first.attrs.start).toBe(1)
    expect(first.childCount).toBe(2)
    expect(first.textContent).toBe('One oneOne two')
    const second = list.child(1).child(1)
    expect(second.type.name).toBe('orderedList')
    expect(second.attrs.start).toBe(1)
    expect(second.textContent).toBe('Two one')
    doc.check()
  })

  it.each([
    ['1.2.', 2],
    ['1.2', 2],
    ['2.1.3', 3],
    ['(1)', 1],
    ['(4)', 4]
  ])('starts an ordered list at the marker %s with %s', (marker, start) => {
    const doc = parseWordHTML(listParagraph('Item', 1, marker))
    expect(doc.child(0).type.name).toBe('orderedList')
    expect(doc.child(0).attrs.start).toBe(start)
    expect(doc.textContent).toBe('Item')
    doc.check()
  })

  it.each(['(a)', '(A)', '(i)', '(iv)'])('keeps a bracketed nondecimal marker %s as an ordered list', (marker) => {
    const doc = parseWordHTML(listParagraph('Item', 1, marker))
    expect(doc.child(0).type.name).toBe('orderedList')
    expect(doc.child(0).attrs.start).toBe(1)
    expect(doc.textContent).toBe('Item')
    doc.check()
  })

  it('converts a Word title whose attributes cannot be copied', () => {
    const doc = parseWordHTML('<p class="MsoTitle" =x>Title</p>')
    expect(doc.childCount).toBe(1)
    expect(doc.child(0).type.name).toBe('heading')
    expect(doc.child(0).attrs.level).toBe(1)
    expect(doc.textContent).toBe('Title')
  })

  it('retains Slack line breaks through the combined HTML paste hook', () => {
    const doc = parseWordHTML('<div data-stringify-type="paragraph">First line\nSecond line</div>')
    expect(doc.firstChild?.child(1).type.name).toBe('hardBreak')
    expect(doc.textContent).toBe('First lineSecond line')
  })

  it('handles literal Word bullet markers without removing content punctuation', () => {
    const doc = parseWordHTML('<p style="mso-list:l1 level1 lfo1">·&nbsp;Keep · in the text</p>')
    expect(doc.firstChild?.type.name).toBe('bulletList')
    expect(doc.textContent).toBe('Keep · in the text')
  })

  it.each(['Note.', 'Note)'])('preserves a leading word %s when there is no marker span', (word) => {
    const doc = parseWordHTML(`<p style="mso-list:l1 level1 lfo1">${word} Keep this text</p>`)
    expect(doc.textContent).toBe(`${word} Keep this text`)
  })

  it.each(['o', '-', 'o content', '- content'])(
    'preserves ambiguous literal content %s without marker metadata',
    (text) => {
      const doc = parseWordHTML(`<p style="mso-list:l1 level1 lfo1">${text}</p>`)
      expect(doc.child(0).type.name).toBe('bulletList')
      expect(doc.textContent).toBe(text)
      doc.check()
    }
  )

  it.each(['o', '-'])('removes an ambiguous bullet %s with explicit marker metadata', (marker) => {
    const doc = parseWordHTML(listParagraph('Item', 1, marker))
    expect(doc.child(0).type.name).toBe('bulletList')
    expect(doc.textContent).toBe('Item')
    doc.check()
  })

  it.each(['3.', '3)', 'a.', 'A)'])('removes the literal ordered marker %s', (marker) => {
    const doc = parseWordHTML(`<p style="mso-list:l1 level1 lfo1">${marker}&nbsp;Item</p>`)
    expect(doc.firstChild?.type.name).toBe('orderedList')
    expect(doc.firstChild?.attrs.start).toBe(marker.startsWith('3') ? 3 : 1)
    expect(doc.textContent).toBe('Item')
  })

  it('keeps separate list runs and lists inside table cells', () => {
    const html = `<table><tr><td>${listParagraph('Cell')}</td></tr></table>`
    const container = document.createElement('div')
    container.innerHTML = normalizeWordPastedHTML(html)
    expect(container.querySelector('td > ul > li > p')?.textContent?.trim()).toBe('Cell')

    const doc = parseWordHTML(listParagraph('Before') + '<p>Between</p>' + listParagraph('After'))
    expect(Array.from({ length: doc.childCount }, (_, i) => doc.child(i).type.name)).toEqual([
      'bulletList',
      'paragraph',
      'bulletList'
    ])
  })

  it('leaves ordinary web HTML, lists, tables and literal bullets unchanged', () => {
    const html = '<h1>Web</h1><p>· Text</p><ul><li><p>Item</p></li></ul><table><tr><td>Cell</td></tr></table>'
    expect(normalizeWordPastedHTML(html)).toBe(html)
  })

  it.each([
    '<html><head><style>p { color:red }</style></head><body><p>MsoTitle is text</p></body></html>',
    '<div data-label="MsoTitle"><p>Keep attribute values</p></div>',
    '<p>mso-list: is literal text</p>',
    '<h1 style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">1.</span>Heading</h1>'
  ])('preserves the original HTML when no supported Word structure changes: %s', (html) => {
    expect(normalizeWordPastedHTML(html)).toBe(html)
  })

  it('serializes converted fragments from the body and leaves schema parsing to ProseMirror', () => {
    const html = `<html><head><style>.MsoTitle { color:red }</style></head><body>
      <p class="MsoTitle"><b>Title</b><unknown> text</unknown></p></body></html>`
    const normalized = normalizeWordPastedHTML(html)
    expect(normalized).not.toContain('<head>')
    expect(normalized).not.toContain('<style>')
    expect(normalized).toContain('<unknown> text</unknown>')
    const doc = parseWordHTML(html)
    expect(doc.childCount).toBe(1)
    expect(doc.child(0).type.name).toBe('heading')
    expect(doc.textContent).toBe('Title text')
    doc.check()
  })

  it('does not wrap paragraphs already in semantic list items in another list', () => {
    const doc = parseWordHTML('<ul><li><p style="mso-list:l0 level1 lfo1">Item</p></li></ul>')
    expect(doc.firstChild?.firstChild?.childCount).toBe(1)
    expect(doc.firstChild?.firstChild?.firstChild?.type.name).toBe('paragraph')
    expect(doc.textContent).toBe('Item')
  })
})
