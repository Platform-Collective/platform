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
  container.innerHTML = plugin.props.transformPastedHTML!.call(plugin, html, {} as unknown as EditorView)
  return DOMParser.fromSchema(pasteSchema).parse(container)
}

function listParagraph (text: string, level = 1, marker = '·', list = 'l0', instance = 'lfo1'): string {
  return `<p class="MsoListParagraph" style="mso-list:${list} level${level} ${instance}">
    <!--[if !supportLists]--><span style="mso-list:Ignore">${marker}<span>&nbsp;&nbsp;</span></span><!--[endif]-->
    ${text}</p>`
}

describe('Word clipboard HTML', () => {
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
    const list = doc.firstChild!
    expect(list.type.name).toBe('bulletList')
    expect(list.childCount).toBe(2)
    expect(list.child(0).child(0).textContent).toBe('First')
    expect(list.child(0).child(0).firstChild?.marks[0].type.name).toBe('bold')
    expect(list.child(0).child(1).type.name).toBe('bulletList')
    expect(list.child(0).child(1).textContent).toBe('Nested')
    expect(list.child(1).textContent).toBe('Second')
    doc.check()

    // The persisted schema content must retain the same lists when reopened.
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
    const list = doc.firstChild!
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

  it('does not wrap paragraphs already in semantic list items in another list', () => {
    const doc = parseWordHTML('<ul><li><p style="mso-list:l0 level1 lfo1">Item</p></li></ul>')
    expect(doc.firstChild?.firstChild?.childCount).toBe(1)
    expect(doc.firstChild?.firstChild?.firstChild?.type.name).toBe('paragraph')
    expect(doc.textContent).toBe('Item')
  })
})
