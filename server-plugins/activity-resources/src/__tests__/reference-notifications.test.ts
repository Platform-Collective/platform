// SPDX-License-Identifier: EPL-2.0

import activity, { type UserMentionInfo } from '@hcengineering/activity'
import contact from '@hcengineering/contact'
import core, {
  TxFactory,
  TxProcessor,
  type AccountUuid,
  type Blob,
  type Doc,
  type Markup,
  type MeasureContext,
  type Ref,
  type Space,
  type Tx,
  type TxCreateDoc,
  type TxCUD,
  type TxUpdateDoc
} from '@hcengineering/core'
import notification from '@hcengineering/notification'
import { type TriggerControl } from '@hcengineering/server-core'
import { getCommonNotificationTxes } from '@hcengineering/server-notification-resources'
import { EmptyMarkup, MarkupNodeType, jsonToMarkup, markupToJSON } from '@hcengineering/text-core'

import { ReferenceTrigger, getReferencesData } from '../references'

jest.mock('@hcengineering/server-contact', () => ({ getPerson: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@hcengineering/server-notification-resources', () => ({
  getNotificationProviderControl: jest.fn().mockResolvedValue({}),
  getAllowedProviders: jest.fn(() => [notification.providers.InboxNotificationProvider]),
  getReceiversInfo: jest.fn().mockResolvedValue([{ account: 'receiver', socialIds: [] }]),
  getCommonNotificationTxes: jest.fn().mockResolvedValue([])
}))

interface CollaborativeDocument extends Doc {
  content: Ref<Blob>
}

function mentionMarkup (text = ' first line', user = 'user'): Markup {
  return jsonToMarkup({
    type: MarkupNodeType.doc,
    content: [
      {
        type: MarkupNodeType.paragraph,
        content: [
          { type: MarkupNodeType.text, text: 'Hello ' },
          {
            type: MarkupNodeType.reference,
            attrs: { id: user, objectclass: contact.class.Person, label: user }
          },
          { type: MarkupNodeType.text, text }
        ]
      }
    ]
  })
}

function createWorkspace (): {
  save: (markup: Markup) => Promise<TxCUD<Doc>[]>
  mentions: Map<Ref<UserMentionInfo>, UserMentionInfo>
} {
  const factory = new TxFactory(core.account.System)
  const space = 'space' as Ref<Space>
  const document = TxProcessor.createDoc2Doc(
    factory.createTxCreateDoc<CollaborativeDocument>(
      core.class.Doc,
      space,
      { content: '' as Ref<Blob> },
      'document' as Ref<CollaborativeDocument>
    )
  )
  const mentions = new Map<Ref<UserMentionInfo>, UserMentionInfo>()
  let markup = EmptyMarkup
  const applied: TxCUD<Doc>[] = []
  const control = {
    txFactory: factory,
    ctx: { contextData: { socialStringsToUsers: new Map() } },
    hierarchy: {
      isDerived: (actual: string, expected: string) => actual === expected,
      getAncestors: () => [core.class.Doc],
      getAllAttributes: () =>
        new Map([['content', { name: 'content', type: { _class: core.class.TypeCollaborativeDoc } }]])
    },
    modelDb: {
      findAllSync: (clazz: string) =>
        clazz === notification.class.NotificationType ? [{ _id: notification.ids.MentionNotificationType }] : []
    },
    storageAdapter: { read: jest.fn(async () => [Buffer.from(markup)]) },
    findAll: jest.fn(async (_ctx: MeasureContext, clazz: string, query: { _id?: string, user?: string }) => {
      if (clazz === core.class.Doc) return [document]
      if (clazz === core.class.Space) return [{ members: ['receiver'], private: false }]
      if (clazz === contact.mixin.Employee) return [{ personUuid: 'receiver' as AccountUuid }]
      if (clazz === activity.class.UserMentionInfo) {
        return Array.from(mentions.values()).filter(
          (mention) => query.user === undefined || mention.user === query.user
        )
      }
      return []
    }),
    apply: jest.fn(async (_ctx: MeasureContext, txes: Tx[]) => {
      for (const tx of txes as TxCUD<Doc>[]) {
        applied.push(tx)
        if (tx.objectClass !== activity.class.UserMentionInfo) continue
        const id = tx.objectId as Ref<UserMentionInfo>
        if (tx._class === core.class.TxCreateDoc) {
          mentions.set(id, TxProcessor.createDoc2Doc(tx as TxCreateDoc<UserMentionInfo>))
        } else if (tx._class === core.class.TxRemoveDoc) {
          mentions.delete(id)
        } else if (tx._class === core.class.TxUpdateDoc) {
          const mention = mentions.get(id)
          if (mention !== undefined) TxProcessor.updateDoc2Doc(mention, tx as TxUpdateDoc<UserMentionInfo>)
        }
      }
    })
  } as unknown as TriggerControl

  return {
    mentions,
    save: async (content) => {
      markup = content
      applied.length = 0
      const tx = factory.createTxUpdateDoc<CollaborativeDocument>(core.class.Doc, space, document._id, {
        content: 'blob' as Ref<Blob>
      })
      await ReferenceTrigger([tx], control)
      return [...applied]
    }
  }
}

describe('collaborative document mention notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('notifies once for a new mention and skips an unchanged save', async () => {
    const workspace = createWorkspace()
    await workspace.save(mentionMarkup())
    expect(getCommonNotificationTxes).toHaveBeenCalledTimes(1)
    expect(workspace.mentions.size).toBe(1)

    expect(await workspace.save(mentionMarkup())).toEqual([])
    expect(getCommonNotificationTxes).toHaveBeenCalledTimes(1)
  })

  it('updates the mention excerpt without notifying again across repeated surrounding text edits', async () => {
    const workspace = createWorkspace()
    await workspace.save(mentionMarkup())
    const [mentionId] = workspace.mentions.keys()

    for (const text of [' first line edit1', ' first line edit1 edit2', ' first line edit1 edit2 edit3']) {
      const updated = mentionMarkup(text)
      const txes = await workspace.save(updated)
      const content = getReferencesData(
        'document' as Ref<Doc>,
        core.class.Doc,
        'document' as Ref<Doc>,
        core.class.Doc,
        updated
      )[0].message

      expect(getCommonNotificationTxes).toHaveBeenCalledTimes(1)
      expect(txes).toHaveLength(1)
      expect(txes[0]).toMatchObject({
        _class: core.class.TxUpdateDoc,
        objectClass: activity.class.UserMentionInfo,
        objectId: mentionId,
        operations: { content }
      })
      expect(workspace.mentions.get(mentionId)?.content).toBe(content)
      expect(await workspace.save(updated)).toEqual([])
      expect(getCommonNotificationTxes).toHaveBeenCalledTimes(1)
    }
  })

  it.each(['same paragraph', 'separate paragraphs'])(
    'notifies once for duplicate mentions in %s, including after one occurrence is removed',
    async (layout) => {
      const workspace = createWorkspace()
      const content = markupToJSON(mentionMarkup())
      const duplicate = markupToJSON(mentionMarkup(' second occurrence'))
      const firstParagraph = content.content?.[0]

      if (layout === 'same paragraph') {
        firstParagraph?.content?.push(...(duplicate.content?.[0].content ?? []))
      } else {
        content.content?.push(...(duplicate.content ?? []))
      }

      await workspace.save(jsonToMarkup(content))
      expect(getCommonNotificationTxes).toHaveBeenCalledTimes(1)
      expect(workspace.mentions.size).toBe(1)
      const [mentionId] = workspace.mentions.keys()

      firstParagraph?.content?.push({ type: MarkupNodeType.text, text: ' edit' })
      await workspace.save(jsonToMarkup(content))
      expect(getCommonNotificationTxes).toHaveBeenCalledTimes(1)

      firstParagraph?.content?.splice(1, 1)
      await workspace.save(jsonToMarkup(content))
      expect(getCommonNotificationTxes).toHaveBeenCalledTimes(1)
      expect(Array.from(workspace.mentions.keys())).toEqual([mentionId])
      expect(await workspace.save(jsonToMarkup(content))).toEqual([])
    }
  )

  it('does not notify again when another paragraph is added', async () => {
    const workspace = createWorkspace()
    const original = mentionMarkup()
    await workspace.save(original)
    const updated = markupToJSON(original)
    updated.content?.push({
      type: MarkupNodeType.paragraph,
      content: [{ type: MarkupNodeType.text, text: 'Another paragraph' }]
    })

    expect(await workspace.save(jsonToMarkup(updated))).toEqual([])
    expect(getCommonNotificationTxes).toHaveBeenCalledTimes(1)
  })

  it('only notifies the new user when an existing mention is edited and another user is mentioned', async () => {
    const workspace = createWorkspace()
    await workspace.save(mentionMarkup())
    const updated = markupToJSON(mentionMarkup(' first line with more words'))
    const otherMention = markupToJSON(mentionMarkup(' another line', 'other-user'))
    updated.content?.push(...(otherMention.content ?? []))

    await workspace.save(jsonToMarkup(updated))

    expect(getCommonNotificationTxes).toHaveBeenCalledTimes(2)
    expect(Array.from(workspace.mentions.values()).map((mention) => mention.user)).toEqual(['user', 'other-user'])
  })

  it('removes the mention record and notifies again when the mention is re-added', async () => {
    const workspace = createWorkspace()
    await workspace.save(mentionMarkup())
    const txes = await workspace.save(EmptyMarkup)
    expect(txes).toHaveLength(1)
    expect(txes[0]).toMatchObject({
      _class: core.class.TxRemoveDoc,
      objectClass: activity.class.UserMentionInfo
    })
    expect(workspace.mentions.size).toBe(0)
    expect(getCommonNotificationTxes).toHaveBeenCalledTimes(1)

    await workspace.save(mentionMarkup())
    expect(workspace.mentions.size).toBe(1)
    expect(getCommonNotificationTxes).toHaveBeenCalledTimes(2)
  })

  it('notifies a newly mentioned user when an existing mention is replaced', async () => {
    const workspace = createWorkspace()
    await workspace.save(mentionMarkup())
    await workspace.save(mentionMarkup(' first line', 'other-user'))

    expect(getCommonNotificationTxes).toHaveBeenCalledTimes(2)
    expect(Array.from(workspace.mentions.values()).map((mention) => mention.user)).toEqual(['other-user'])
  })
})
