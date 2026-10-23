// SPDX-License-Identifier: EPL-2.0

import { MarkupNodeType, type MarkupNode } from '@hcengineering/text-core'
import { ServerKit } from '../../kits/server-kit'
import { htmlToJSON, jsonToHTML, jsonToPmNode } from '../utils'

describe('callout in the shared server schema', () => {
  it.each(['info', 'warning', 'success'])('round-trips %s and optional emoji through HTML', (kind) => {
    const doc: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.callout,
          attrs: { kind, emoji: '💡 "<&' },
          content: [{ type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: 'Note' }] }]
        }
      ]
    }
    const expected = jsonToPmNode(doc).toJSON()
    const html = jsonToHTML(doc, [ServerKit])
    expect(html).toContain('data-type="callout"')
    expect(htmlToJSON(html, [ServerKit])).toEqual(expected)
  })

  it('defaults missing and unsupported kinds to info', () => {
    for (const attrs of ['', ' data-kind="unsupported"']) {
      const doc = htmlToJSON(`<div data-type="callout"${attrs}><p>Note</p></div>`)
      expect(doc.content?.[0].attrs).toEqual({ kind: 'info', emoji: null })
    }
  })

  it('still parses ordinary blockquotes independently', () => {
    expect(htmlToJSON('<blockquote><p>Quote</p></blockquote>').content?.[0].type).toBe('blockquote')
  })
})
