// SPDX-License-Identifier: EPL-2.0

import type { Doc } from '@hcengineering/core'
import {
  jsonToMarkup,
  markupToJSON,
  MarkupNodeType,
  markBold,
  nodeDoc,
  nodeParagraph,
  nodeText
} from '@hcengineering/text-core'
import { getMessageToDoContent, isMessageToDoSource, withPlannedTime } from '../message-todo'

const LINK = 'https://huly.example/workbench/workspace/chunter/channel?message=message-1'

describe('message ToDo content', () => {
  it('uses only the first paragraph, strips formatting, and trims whitespace', () => {
    const message = jsonToMarkup(
      nodeDoc(nodeParagraph(markBold(nodeText('  Follow up  '))), nodeParagraph(nodeText('Later')))
    )
    expect(getMessageToDoContent(message, LINK, 'Action Item').title).toBe('Follow up')
  })

  it('uses only the first line at a hard break', () => {
    const message = jsonToMarkup(
      nodeDoc(nodeParagraph(nodeText('First line'), { type: MarkupNodeType.hard_break }, nodeText('Second line')))
    )
    expect(getMessageToDoContent(message, LINK, 'Action Item').title).toBe('First line')
  })

  it('preserves mention labels and handles plain text with newlines', () => {
    const message = jsonToMarkup(
      nodeDoc(nodeParagraph({ type: MarkupNodeType.reference, attrs: { label: 'Alex' } }, nodeText(' please review')))
    )
    expect(getMessageToDoContent(message, LINK, 'Action Item').title).toBe('Alex please review')
    expect(getMessageToDoContent('First\r\nSecond', LINK, 'Action Item').title).toBe('First')
  })

  it.each([
    '',
    '{invalid JSON',
    jsonToMarkup(nodeDoc(nodeParagraph())),
    jsonToMarkup(nodeDoc({ type: MarkupNodeType.image }))
  ])('uses a translated fallback for empty or non-text messages: %s', (message) => {
    expect(getMessageToDoContent(message, LINK, 'Action Item').title).toBe('Action Item')
  })

  it('creates valid link markup with the full thread URL and no message body', () => {
    const link = `${LINK}&thread=parent&quote="quoted"`
    const { description } = getMessageToDoContent('Title\nPrivate body', link, 'Action Item')
    expect(markupToJSON(description)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: link, marks: [{ type: 'link', attrs: { href: link, title: 'Title' } }] }]
        }
      ]
    })
    expect(description).not.toContain('Private body')
  })

  it('recognizes message documents and ignores missing or non-message objects', () => {
    expect(isMessageToDoSource({ message: '' } as unknown as Doc)).toBe(true)
    expect(isMessageToDoSource({ message: 42 } as unknown as Doc)).toBe(false)
    expect(isMessageToDoSource({} as unknown as Doc)).toBe(false)
    expect(isMessageToDoSource()).toBe(false)
  })

  it('appends the chosen time to the title', () => {
    const dueDate = new Date(2026, 9, 24, 14, 30).getTime()
    expect(withPlannedTime('Follow up', dueDate, 'en-GB')).toBe('Follow up (14:30)')
  })
})
