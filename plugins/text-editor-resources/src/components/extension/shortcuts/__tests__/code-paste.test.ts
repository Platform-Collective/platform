/** @jest-environment jsdom */

// SPDX-License-Identifier: EPL-2.0

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

import { SmartPasteExtension } from '../smartPaste'

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

function makeClipboardData (plain: string): any {
  return {
    types: ['text/plain'],
    getData: (t: string) => (t === 'text/plain' ? plain : '')
  } as any
}

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
    const event = { clipboardData: makeClipboardData(code) } as unknown as ClipboardEvent

    editor.view.pasteText(code, event)

    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(['paragraph', 'paragraph'])
  })

  it('preserves Slack line breaks when normalizing code', () => {
    pasteHTML('<pre data-stringify-type="pre"><code>first\n  second</code></pre>')

    expect(editor.getJSON().content).toEqual([
      { type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: 'first\n  second' }] }
    ])
  })

  it('applies the Word list and code stages to the same paste', () => {
    pasteHTML(
      '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1">' +
        '<!--[if !supportLists]--><span style="mso-list:Ignore">1.<span>&nbsp;&nbsp;</span></span><!--[endif]-->' +
        'Item</p><p>Run<code>first\n  second</code></p>'
    )

    expect(editor.getJSON().content).toEqual([
      {
        type: 'orderedList',
        attrs: expect.objectContaining({ start: 1 }),
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item' }] }] }]
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'Run' }] },
      { type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: 'first\n  second' }] }
    ])
  })
})
