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

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Schema } from '@tiptap/pm/model'
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'

import { normalizeSlackPastedHTML, PasteTextAsMarkdownPlugin, SmartPasteExtension } from '../smartPaste'

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

describe('SmartPaste structured HTML', () => {
  let editor: Editor

  function pasteHTML (html: string): void {
    editor.view.pasteHTML(html, { clipboardData: null } as unknown as ClipboardEvent)
  }

  beforeEach(() => {
    editor = new Editor({ extensions: [StarterKit, SmartPasteExtension] })
  })

  afterEach(() => {
    editor.destroy()
  })

  it('keeps only the code and its language from a decorated pre', () => {
    const code = '\n\tif x < 2:\n    print("hello & goodbye")\n\n'
    const html =
      '<p>Before</p><pre><div>python<button>Copy</button></div>' +
      '<div><code class="language-python"><span>\n\tif x &lt; 2:</span>\n' +
      '    print("hello &amp; goodbye")\n\n</code></div></pre><p>After</p>'

    pasteHTML(html)

    expect(editor.getJSON().content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
      { type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: code }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'After' }] }
    ])
  })

  it('keeps the text of every code element in a pre with several code children', () => {
    pasteHTML('<pre><code>first()</code>\n<code>second()</code></pre>')

    const text = editor.getText()
    expect(text).toContain('first()')
    expect(text).toContain('second()')
  })

  it('turns a bare multiline code fragment into a block without losing whitespace', () => {
    const code = '\nconst value = 1\n\tconsole.log(value)\n'

    pasteHTML('<code class="language-javascript">' + code + '</code>')

    expect(editor.getJSON().content).toEqual([
      { type: 'codeBlock', attrs: { language: 'javascript' }, content: [{ type: 'text', text: code }] }
    ])
  })

  it('preserves text around a bare multiline code fragment', () => {
    pasteHTML('<p>Before<code>first\n  second</code>After</p>')

    expect(editor.getJSON().content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
      { type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: 'first\n  second' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'After' }] }
    ])
  })

  it('preserves explicit line breaks inside code', () => {
    pasteHTML('<code><span>first</span><br><span>  second</span><br></code>')

    expect(editor.getJSON().content).toEqual([
      { type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: 'first\n  second\n' }] }
    ])
  })

  it('keeps single-line code inline', () => {
    pasteHTML('<p>Use <code>value &lt; 2</code> here</p>')

    expect(editor.getJSON().content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Use ' },
          { type: 'text', marks: [{ type: 'code' }], text: 'value < 2' },
          { type: 'text', text: ' here' }
        ]
      }
    ])
  })

  it('preserves ordinary pre/code blocks and their language', () => {
    pasteHTML('<pre><code class="language-python">\n  x = 1\n\n</code></pre>')

    expect(editor.getJSON().content).toEqual([
      { type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: '\n  x = 1\n\n' }] }
    ])
  })

  it('preserves pre blocks without code elements', () => {
    pasteHTML('<pre>first\n  second\n</pre>')

    expect(editor.getJSON().content).toEqual([
      { type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: 'first\n  second\n' }] }
    ])
  })

  it('keeps code-like text without code elements as text', () => {
    pasteHTML('<p>def example():</p><p>    return 1</p>')

    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(['paragraph', 'paragraph'])
  })

  it('keeps metadata-free plain code text as text', () => {
    const code = 'def example():\n    return 1'
    const event = { clipboardData: makeClipboardData({ plain: code }) } as unknown as ClipboardEvent

    editor.view.pasteText(code, event)

    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(['paragraph', 'paragraph'])
  })

  it('preserves Slack line breaks when normalizing code', () => {
    pasteHTML('<pre data-stringify-type="pre"><code>first\n  second</code></pre>')

    expect(editor.getJSON().content).toEqual([
      { type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: 'first\n  second' }] }
    ])
  })
})
