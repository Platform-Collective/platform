/** @jest-environment jsdom */

// SPDX-License-Identifier: EPL-2.0

import type { MarkupNode } from '@hcengineering/text'
import { markupToHtml } from '@hcengineering/text-html'
import { markupToMarkdown } from '@hcengineering/text-markdown'
import { getSchema } from '@tiptap/core'
import { DOMParser } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'

import { normalizeWordPastedHTML } from '../word-paste'

const pasteSchema = getSchema([StarterKit])

describe('Word paste exports', () => {
  it.each([0, 3, 10])('preserves decimal start %s through the editor schema and both export serializers', (start) => {
    // Synthetic Word paragraphs from the same list instance, with explicit decimal markers.
    const html = [
      `<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">${start}.</span>Third</p>`,
      `<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">${start + 1}.</span>Fourth</p>`
    ].join('')
    const container = document.createElement('div')
    container.innerHTML = normalizeWordPastedHTML(html)
    const doc = DOMParser.fromSchema(pasteSchema).parse(container)
    doc.check()
    expect(doc.child(0).attrs.start).toBe(start)

    const markup: MarkupNode = doc.toJSON()
    expect(markupToMarkdown(markup)).toBe(`${start}. Third\n${start + 1}. Fourth`)
    const exportedHTML = markupToHtml(markup)
    expect(exportedHTML).toBe(`<ol start="${start}"><li><p>Third</p></li><li><p>Fourth</p></li></ol>`)

    container.innerHTML = exportedHTML
    expect(DOMParser.fromSchema(pasteSchema).parse(container).toJSON()).toEqual(markup)
  })
})
