// SPDX-License-Identifier: EPL-2.0

import { MarkupNodeType, type MarkupNode } from '@hcengineering/text-core'
import { ServerKit } from '../../kits/server-kit'
import { htmlToJSON, jsonToHTML, jsonToPmNode } from '../utils'

describe('callout in the shared server schema', () => {
  it('round-trips info and optional emoji through HTML', () => {
    const doc: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.callout,
          attrs: { kind: 'info', emoji: '💡' },
          content: [{ type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: 'Note' }] }]
        }
      ]
    }
    const expected = jsonToPmNode(doc).toJSON()
    const html = jsonToHTML(doc, [ServerKit])
    expect(html).toContain('data-type="callout"')
    expect(htmlToJSON(html, [ServerKit])).toEqual(expected)
  })

  it('defaults missing and deferred kinds to info', () => {
    for (const attrs of ['', ' data-kind="unsupported"', ' data-kind="warning"', ' data-kind="success"']) {
      const doc = htmlToJSON(`<div data-type="callout"${attrs}><p>Note</p></div>`)
      expect(doc.content?.[0].attrs).toEqual({ kind: 'info', emoji: null })
    }
  })

  it('limits emoji to sixteen UTF-16 code units in parseHTML', () => {
    const longEmoji = '12345678901234567'
    const doc = htmlToJSON(`<div data-type="callout" data-emoji="${longEmoji}"><p>Note</p></div>`)
    expect(doc.content?.[0].attrs?.emoji).toBeNull()
  })

  it('still parses ordinary blockquotes independently', () => {
    expect(htmlToJSON('<blockquote><p>Quote</p></blockquote>').content?.[0].type).toBe('blockquote')
  })
})
