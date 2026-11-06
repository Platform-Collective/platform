// SPDX-License-Identifier: EPL-2.0

import activity, { type UserMentionInfo } from '@hcengineering/activity'
import contact from '@hcengineering/contact'
import core, {
  TxFactory,
  TxProcessor,
  type Class,
  type Doc,
  type DocumentUpdate,
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

// A message class: removing its mentions also removes the mention notifications of the message.
const messageClass = 'test:class:Message' as Ref<Class<Doc>>
const ancestors = new Map<string, string[]>([[messageClass, [activity.class.ActivityMessage, core.class.Doc]]])

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

function mentionExcerpt (markup: Markup): string {
  const document = 'document' as Ref<Doc>
  return getReferencesData(document, core.class.Doc, document, core.class.Doc, markup)[0].message
}

function matches (doc: object, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, value]) => Reflect.get(doc, key) === value)
}

function createWorkspace ({
  docClass = core.class.Doc,
  fields = ['content']
}: { docClass?: Ref<Class<Doc>>, fields?: string[] } = {}): {
  save: (markup: Markup | Record<string, Markup>) => Promise<TxCUD<Doc>[]>
  mentions: Map<Ref<UserMentionInfo>, UserMentionInfo>
  notifications: Array<Record<string, unknown>>
} {
  const factory = new TxFactory(core.account.System)
  const space = 'space' as Ref<Space>
  const document = TxProcessor.createDoc2Doc(
    factory.createTxCreateDoc<Doc>(docClass, space, {}, 'document' as Ref<Doc>)
  )
  const mentions = new Map<Ref<UserMentionInfo>, UserMentionInfo>()
  const notifications: Array<Record<string, unknown>> = []
  const markups = new Map<string, Markup>()
  const applied: TxCUD<Doc>[] = []
  const control = {
    txFactory: factory,
    ctx: { contextData: { socialStringsToUsers: new Map() } },
    hierarchy: {
      isDerived: (actual: string, expected: string) =>
        actual === expected || (ancestors.get(actual) ?? []).includes(expected),
      getAncestors: () => [core.class.Doc],
      getAllAttributes: () =>
        new Map(fields.map((name) => [name, { name, type: { _class: core.class.TypeCollaborativeDoc } }]))
    },
    modelDb: {
      findAllSync: (clazz: string) =>
        clazz === notification.class.NotificationType ? [{ _id: notification.ids.MentionNotificationType }] : []
    },
    storageAdapter: {
      read: jest.fn(async (_ctx: MeasureContext, _workspace: unknown, blobId: string) => [
        Buffer.from(markups.get(blobId) ?? EmptyMarkup)
      ])
    },
    findAll: jest.fn(async (_ctx: MeasureContext, clazz: string, query: Record<string, unknown>) => {
      if (clazz === docClass) return [document]
      if (clazz === core.class.Space) return [{ members: ['receiver'], private: false }]
      if (clazz === contact.mixin.Employee) return [{ personUuid: 'receiver' }]
      if (clazz === activity.class.UserMentionInfo) {
        return Array.from(mentions.values()).filter((mention) => matches(mention, query))
      }
      return notifications.filter((it) => it._class === clazz && matches(it, query))
    }),
    apply: jest.fn(async (_ctx: MeasureContext, txes: Tx[]) => {
      for (const tx of txes as TxCUD<Doc>[]) {
        applied.push(tx)
        if (tx._class === core.class.TxRemoveDoc) {
          const index = notifications.findIndex((it) => it._id === tx.objectId)
          if (index !== -1) notifications.splice(index, 1)
        }
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
    notifications,
    save: async (content) => {
      // Each field is a collaborative document whose blob id is the field name.
      const values = typeof content === 'string' ? { [fields[0]]: content } : content
      markups.clear()
      for (const [field, markup] of Object.entries(values)) markups.set(field, markup)
      applied.length = 0
      const operations = Object.fromEntries(fields.map((field) => [field, field])) as unknown as DocumentUpdate<Doc>
      const tx = factory.createTxUpdateDoc<Doc>(docClass, space, document._id, operations)
      await ReferenceTrigger([tx], control)
      return [...applied]
    }
  }
}

function expectNotifications (count: number): void {
  expect(getCommonNotificationTxes).toHaveBeenCalledTimes(count)
}

describe('collaborative document mention notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('notifies once for a new mention and skips an unchanged save', async () => {
    const workspace = createWorkspace()
    await workspace.save(mentionMarkup())
    expectNotifications(1)
    expect(workspace.mentions.size).toBe(1)

    expect(await workspace.save(mentionMarkup())).toEqual([])
    expectNotifications(1)
  })

  it('updates the mention excerpt without notifying again across repeated surrounding text edits', async () => {
    const workspace = createWorkspace()
    await workspace.save(mentionMarkup())
    const [mentionId] = workspace.mentions.keys()

    for (const text of [' first line edit1', ' first line edit1 edit2', ' first line edit1 edit2 edit3']) {
      const updated = mentionMarkup(text)
      const txes = await workspace.save(updated)
      const content = mentionExcerpt(updated)

      expectNotifications(1)
      expect(txes).toHaveLength(1)
      expect(txes[0]).toMatchObject({
        _class: core.class.TxUpdateDoc,
        objectClass: activity.class.UserMentionInfo,
        objectId: mentionId,
        operations: { content }
      })
      expect(workspace.mentions.get(mentionId)?.content).toBe(content)
      expect(await workspace.save(updated)).toEqual([])
      expectNotifications(1)
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
      expectNotifications(1)
      expect(workspace.mentions.size).toBe(1)
      const [mentionId] = workspace.mentions.keys()

      firstParagraph?.content?.push({ type: MarkupNodeType.text, text: ' edit' })
      await workspace.save(jsonToMarkup(content))
      expectNotifications(1)

      firstParagraph?.content?.splice(1, 1)
      await workspace.save(jsonToMarkup(content))
      expectNotifications(1)
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
    expectNotifications(1)
  })

  it('only notifies the new user when an existing mention is edited and another user is mentioned', async () => {
    const workspace = createWorkspace()
    await workspace.save(mentionMarkup())
    const updated = markupToJSON(mentionMarkup(' first line with more words'))
    const otherMention = markupToJSON(mentionMarkup(' another line', 'other-user'))
    updated.content?.push(...(otherMention.content ?? []))

    await workspace.save(jsonToMarkup(updated))

    expectNotifications(2)
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
    expectNotifications(1)

    await workspace.save(mentionMarkup())
    expect(workspace.mentions.size).toBe(1)
    expectNotifications(2)
  })

  it('notifies a newly mentioned user when an existing mention is replaced', async () => {
    const workspace = createWorkspace()
    await workspace.save(mentionMarkup())
    await workspace.save(mentionMarkup(' first line', 'other-user'))

    expectNotifications(2)
    expect(Array.from(workspace.mentions.values()).map((mention) => mention.user)).toEqual(['other-user'])
  })

  it('drops only a duplicate mention record and keeps the notifications of a mention that still exists', async () => {
    const workspace = createWorkspace({ docClass: messageClass })
    await workspace.save(mentionMarkup())
    expectNotifications(1)
    const [original] = workspace.mentions.values()
    const addDuplicate = (id: string): UserMentionInfo => {
      const duplicate = { ...original, _id: id as Ref<UserMentionInfo> }
      workspace.mentions.set(duplicate._id, duplicate)
      return duplicate
    }
    const notificationOf = { space: original.space, user: 'receiver' }
    workspace.notifications.push(
      {
        ...notificationOf,
        _id: 'mention',
        _class: notification.class.MentionInboxNotification,
        mentionedIn: 'document'
      },
      {
        ...notificationOf,
        _id: 'mention-activity',
        _class: notification.class.ActivityInboxNotification,
        attachedTo: 'document',
        types: [notification.ids.MentionNotificationType]
      },
      {
        ...notificationOf,
        _id: 'other-activity',
        _class: notification.class.ActivityInboxNotification,
        attachedTo: 'document',
        types: [notification.ids.MentionNotificationType, 'other-type']
      }
    )

    const duplicate = addDuplicate('duplicate-mention')
    const txes = await workspace.save(mentionMarkup(' first line edited'))

    expectNotifications(1)
    expect(txes.map((tx) => [tx._class, tx.objectId])).toEqual([
      [core.class.TxUpdateDoc, original._id],
      [core.class.TxRemoveDoc, duplicate._id]
    ])
    expect(Array.from(workspace.mentions.keys())).toEqual([original._id])
    expect(workspace.notifications.map((it) => it._id)).toEqual(['mention', 'mention-activity', 'other-activity'])

    // A mention that is really removed still removes its notifications, once, and drops a duplicate record.
    const secondDuplicate = addDuplicate('second-duplicate-mention')
    const removeTxes = await workspace.save(EmptyMarkup)

    expect(removeTxes.map((tx) => [tx._class, tx.objectId])).toEqual([
      [core.class.TxRemoveDoc, original._id],
      [core.class.TxRemoveDoc, 'mention-activity'],
      [core.class.TxRemoveDoc, 'mention'],
      [core.class.TxRemoveDoc, secondDuplicate._id]
    ])
    expect(workspace.mentions.size).toBe(0)
    expect(workspace.notifications.map((it) => it._id)).toEqual(['other-activity'])
  })

  it.each([
    ['content', 'description'],
    ['description', 'content']
  ])('keeps one mention record and one notification for a person mentioned in %s and %s', async (first, second) => {
    const workspace = createWorkspace({ fields: [first, second] })
    const both = (firstText: string, secondText: string): Record<string, Markup> => ({
      [first]: mentionMarkup(firstText),
      [second]: mentionMarkup(secondText)
    })

    await workspace.save(both(' first field', ' second field'))
    expectNotifications(1)
    expect(workspace.mentions.size).toBe(1)
    const [original] = workspace.mentions.values()
    expect(original.content).toBe(mentionExcerpt(mentionMarkup(' first field')))

    expect(await workspace.save(both(' first field', ' second field'))).toEqual([])
    expectNotifications(1)

    const duplicate = { ...original, _id: 'duplicate-mention' as Ref<UserMentionInfo> }
    workspace.mentions.set(duplicate._id, duplicate)
    const txes = await workspace.save(both(' first field edited', ' second field edited'))

    expectNotifications(1)
    expect(txes.map((tx) => [tx._class, tx.objectId])).toEqual([
      [core.class.TxUpdateDoc, original._id],
      [core.class.TxRemoveDoc, duplicate._id]
    ])
    expect(Array.from(workspace.mentions.keys())).toEqual([original._id])

    // Removing the mention from one field keeps it: only the excerpt moves to the other field.
    const remaining = mentionMarkup(' second field edited')
    const moved = await workspace.save({ [first]: EmptyMarkup, [second]: remaining })

    expectNotifications(1)
    expect(moved.map((tx) => [tx._class, tx.objectId])).toEqual([[core.class.TxUpdateDoc, original._id]])
    expect(workspace.mentions.get(original._id)?.content).toBe(mentionExcerpt(remaining))
  })

  it('refreshes a legacy mention record whose content is not valid JSON instead of failing the trigger', async () => {
    const workspace = createWorkspace()
    await workspace.save(mentionMarkup())
    const [mention] = workspace.mentions.values()
    mention.content = ''

    const txes = await workspace.save(mentionMarkup())

    expectNotifications(1)
    expect(txes).toHaveLength(1)
    expect(txes[0]).toMatchObject({ _class: core.class.TxUpdateDoc, objectId: mention._id })
    expect(workspace.mentions.get(mention._id)?.content).not.toBe('')
  })
})
