// SPDX-License-Identifier: EPL-2.0
import { getChatDrafts } from '../chat-drafts'

const chat = 'chunter:class:ChatMessage'
const thread = 'chunter:class:ThreadMessage'
const text = JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Unsent' }] }]
})
const empty = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] })

describe('chat draft discovery', () => {
  it('finds channel and thread drafts, preserving underscores in target IDs', () => {
    expect(
      getChatDrafts({
        [`channel_with_underscores_${chat}`]: { _id: 'draft1', message: text, attachments: 0 },
        [`parent_${thread}`]: { _id: 'draft2', message: empty, attachments: 1 }
      })
    ).toEqual([
      { key: `channel_with_underscores_${chat}`, target: 'channel_with_underscores', thread: false },
      { key: `parent_${thread}`, target: 'parent', thread: true }
    ])
  })

  it('ignores empty, unrelated and malformed drafts without dropping valid rich content', () => {
    const image = JSON.stringify({ type: 'doc', content: [{ type: 'image', attrs: { src: 'image' } }] })
    expect(
      getChatDrafts({
        [`blank_${chat}`]: { message: empty, attachments: 0 },
        [`space_${chat}`]: {
          message: JSON.stringify({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '  ' }] }]
          })
        },
        [`bad_${chat}`]: { message: '{invalid' },
        [`null_${chat}`]: null,
        [`array_${chat}`]: [],
        [`attachment_${chat}`]: { attachments: 2 },
        [`image_${chat}`]: { message: image },
        'tracker:ids:IssueDraft': ['issue'],
        issue: { message: text },
        [`_${chat}`]: { message: text }
      }).map((draft) => draft.target)
    ).toEqual(['attachment', 'image'])
  })

  it('uses composer markup semantics for legacy text, empty lists and inline content', () => {
    const markup = (node: unknown): string => JSON.stringify({ type: 'doc', content: [node] })
    expect(
      getChatDrafts({
        [`legacy_${chat}`]: { message: 'Old plain text draft' },
        [`emptyList_${chat}`]: {
          message: markup({ type: 'bullet_list', content: [{ type: 'list_item', content: [{ type: 'paragraph' }] }] })
        },
        [`hardBreak_${chat}`]: { message: markup({ type: 'hard_break' }) },
        [`mention_${chat}`]: { message: markup({ type: 'reference', attrs: { id: 'person' } }) },
        [`gif_${chat}`]: { message: markup({ type: 'gif', attrs: { src: 'image' } }) }
      }).map((draft) => draft.target)
    ).toEqual(['legacy', 'mention', 'gif'])
  })

  it('reflects clearing and sending without mutating stored drafts', () => {
    const draft = Object.freeze({ message: text, attachments: 0 })
    const store = { [`channel_${chat}`]: draft }
    expect(getChatDrafts(Object.freeze(store))).toHaveLength(1)
    expect(getChatDrafts({})).toEqual([])
    expect(draft.message).toBe(text)
  })
})
