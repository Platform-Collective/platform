// SPDX-License-Identifier: EPL-2.0

import { MarkupNodeType } from '@hcengineering/text-core'
import { htmlToMarkup, markupToHtml } from '..'

it.each([null, '', undefined])('keeps file-id through notification/email HTML when src is %s', (src) => {
  const html = markupToHtml({
    type: MarkupNodeType.doc,
    content: [
      {
        type: MarkupNodeType.paragraph,
        content: [
          {
            type: MarkupNodeType.image,
            attrs: { 'file-id': 'blob"&/id', src, alt: 'image.png', width: 320 }
          }
        ]
      }
    ]
  })
  expect(html).toContain('file-id="blob&quot;&amp;/id"')
  expect(html).not.toContain('src="null"')
  expect(html).not.toContain('src=""')
  const image = htmlToMarkup(html).content?.[0].content?.[0]
  expect(image?.type).toBe('image')
  expect(image?.attrs?.['file-id']).toBe('blob"&/id')
  expect(image?.attrs?.width).toBe(320)
})
