// SPDX-License-Identifier: EPL-2.0
import {
  ATTACHMENT_MARKER,
  attachmentBlock,
  attachmentLink,
  splitAttachmentBlock,
  withAttachments
} from '../sync/attachments'

describe('the attachment block of a note', () => {
  it('links images inline and other files as links, escaping the name', () => {
    expect(attachmentLink('shot.png', 'image/png', '/uploads/s/shot.png')).toBe('![shot.png](/uploads/s/shot.png)')
    expect(attachmentLink('a [b].pdf', 'application/pdf', '/uploads/s/a.pdf')).toBe('[a \\[b\\].pdf](/uploads/s/a.pdf)')
  })

  it('wraps a path with a space in angle brackets', () => {
    expect(attachmentLink('my shot.png', 'image/png', '/uploads/s/my shot.png')).toBe(
      '![my shot.png](</uploads/s/my shot.png>)'
    )
  })

  it('builds, appends and splits a block', () => {
    const block = attachmentBlock(['![a](/uploads/s/a.png)'])
    expect(block).toBe(`${ATTACHMENT_MARKER}\n![a](/uploads/s/a.png)`)
    expect(attachmentBlock([])).toBe('')
    const body = withAttachments('Hello', block)
    expect(body).toBe(`Hello\n\n${block}`)
    expect(splitAttachmentBlock(body)).toEqual({ text: 'Hello', block })
    expect(withAttachments('', block)).toBe(block)
    expect(withAttachments('Hello', '')).toBe('Hello')
    expect(splitAttachmentBlock('No block')).toEqual({ text: 'No block', block: '' })
  })
})
