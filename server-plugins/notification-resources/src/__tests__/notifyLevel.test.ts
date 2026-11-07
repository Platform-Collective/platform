// SPDX-License-Identifier: EPL-2.0

import { type PersonSpace } from '@hcengineering/contact'
import { type AccountUuid, type Class, type Doc, type Markup, type Ref } from '@hcengineering/core'
import { type DocNotifyLevel } from '@hcengineering/notification'

import {
  getApplicableNotifyLevels,
  isAllowedByNotifyLevels,
  isMentionedInMarkup,
  type NotifyLevelContext,
  type NotifyLevelSource,
  type PersistedParentMessage,
  selectReceiverNotifyLevel,
  shouldNotifyForLevel
} from '../notifyLevel'

function markupWithReference (id: string): Markup {
  return JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hi ' },
          { type: 'reference', attrs: { id, objectclass: 'contact:class:Person', label: 'John' } }
        ]
      }
    ]
  })
}

describe('shouldNotifyForLevel', () => {
  it('notifies about everything when the level is unset or all', () => {
    expect(shouldNotifyForLevel(undefined, false)).toBe(true)
    expect(shouldNotifyForLevel(undefined, true)).toBe(true)
    expect(shouldNotifyForLevel('all', false)).toBe(true)
    expect(shouldNotifyForLevel('all', true)).toBe(true)
  })

  it('notifies only about mentions when the level is mentions', () => {
    expect(shouldNotifyForLevel('mentions', false)).toBe(false)
    expect(shouldNotifyForLevel('mentions', true)).toBe(true)
  })

  it('never notifies when the level is none', () => {
    expect(shouldNotifyForLevel('none', false)).toBe(false)
    expect(shouldNotifyForLevel('none', true)).toBe(false)
  })
})

describe('isMentionedInMarkup', () => {
  it('detects a reference to one of the targets', () => {
    expect(isMentionedInMarkup(markupWithReference('person-1'), ['person-1'])).toBe(true)
    expect(isMentionedInMarkup(markupWithReference('everyone'), ['person-1', 'everyone'])).toBe(true)
  })

  it('ignores references to other ids', () => {
    expect(isMentionedInMarkup(markupWithReference('person-2'), ['person-1'])).toBe(false)
  })

  it('handles empty or invalid markup', () => {
    expect(isMentionedInMarkup(undefined, ['person-1'])).toBe(false)
    expect(isMentionedInMarkup('', ['person-1'])).toBe(false)
    expect(isMentionedInMarkup('not json', ['person-1'])).toBe(false)
    expect(isMentionedInMarkup(markupWithReference('person-1'), [])).toBe(false)
  })
})

describe('selectReceiverNotifyLevel', () => {
  const channel = 'channel-1' as Ref<Doc>
  const receiver = { account: 'acc-a' as AccountUuid, space: 'space-a' as Ref<PersonSpace> }

  const ctx = (
    notifyLevel: DocNotifyLevel | undefined,
    overrides: Partial<NotifyLevelContext> = {}
  ): NotifyLevelContext => ({
    objectId: channel,
    user: receiver.account,
    space: receiver.space,
    notifyLevel,
    ...overrides
  })

  it('returns the level of the receiver own context', () => {
    expect(selectReceiverNotifyLevel([ctx('none')], channel, receiver)).toBe('none')
    expect(selectReceiverNotifyLevel([undefined, ctx('mentions')], channel, receiver)).toBe('mentions')
  })

  it('returns undefined when there is no context or no level', () => {
    expect(selectReceiverNotifyLevel([], channel, receiver)).toBeUndefined()
    expect(selectReceiverNotifyLevel([undefined, ctx(undefined)], channel, receiver)).toBeUndefined()
  })

  it('ignores a context stored outside the receiver personal space', () => {
    const foreign = ctx('none', { space: 'space-other' as Ref<PersonSpace> })
    expect(selectReceiverNotifyLevel([foreign], channel, receiver)).toBeUndefined()
  })

  it('ignores a foreign context and uses the receiver own one', () => {
    const foreign = ctx('none', { space: 'space-other' as Ref<PersonSpace> })
    expect(selectReceiverNotifyLevel([foreign, ctx('mentions')], channel, receiver)).toBe('mentions')
  })

  it('ignores contexts of other users or other documents', () => {
    const otherUser = ctx('none', { user: 'acc-b' as AccountUuid })
    const otherDoc = ctx('none', { objectId: 'other' as Ref<Doc> })
    expect(selectReceiverNotifyLevel([otherUser], channel, receiver)).toBeUndefined()
    expect(selectReceiverNotifyLevel([otherDoc], channel, receiver)).toBeUndefined()
  })
})

describe('isAllowedByNotifyLevels (thread reply in a channel)', () => {
  // levels: [thread context level, enclosing channel level]
  it('allows replies when no level restricts and does not evaluate mentions', () => {
    const isMention = jest.fn(() => false)
    expect(isAllowedByNotifyLevels([undefined, undefined], isMention)).toBe(true)
    expect(isAllowedByNotifyLevels([undefined, 'all'], isMention)).toBe(true)
    expect(isMention).not.toHaveBeenCalled()
  })

  it('blocks every reply when the channel level is none, even mentions', () => {
    expect(isAllowedByNotifyLevels([undefined, 'none'], () => false)).toBe(false)
    expect(isAllowedByNotifyLevels([undefined, 'none'], () => true)).toBe(false)
  })

  it('allows only mentioned replies when the channel level is mentions', () => {
    expect(isAllowedByNotifyLevels([undefined, 'mentions'], () => false)).toBe(false)
    expect(isAllowedByNotifyLevels([undefined, 'mentions'], () => true)).toBe(true)
  })

  it('applies the strictest of thread and channel levels', () => {
    expect(isAllowedByNotifyLevels(['none', 'mentions'], () => true)).toBe(false)
    expect(isAllowedByNotifyLevels(['mentions', undefined], () => true)).toBe(true)
  })
})

describe('getApplicableNotifyLevels', () => {
  const receiver = { account: 'acc-a' as AccountUuid, space: 'space-a' as Ref<PersonSpace> }
  const channel = 'channel-1' as Ref<Doc>
  const rootMessage = 'root-msg' as Ref<Doc>
  const chatMessageClass = 'chunter:class:ChatMessage' as Ref<Class<Doc>>

  const own = (objectId: Ref<Doc>, notifyLevel: DocNotifyLevel): NotifyLevelContext => ({
    objectId,
    user: receiver.account,
    space: receiver.space,
    notifyLevel
  })

  const makeSource = (
    parent: PersistedParentMessage | undefined,
    restricted: NotifyLevelContext[]
  ): NotifyLevelSource & { findParentMessage: jest.Mock, findRestrictedContexts: jest.Mock } => ({
    findParentMessage: jest.fn(async (objectId: Ref<Doc>) => (parent?._id === objectId ? parent : undefined)),
    isThreadParent: (parentClass) => parentClass === chatMessageClass,
    findRestrictedContexts: jest.fn(async (objectId: Ref<Doc>) => restricted.filter((c) => c.objectId === objectId))
  })

  const thread = (attachedTo?: Ref<Doc>): PersistedParentMessage => ({
    _id: rootMessage,
    _class: chatMessageClass,
    attachedTo
  })

  const isMentionClass = (): boolean => true // e.g. a MentionInboxNotification from an edited reply

  it('returns only the own level for documents that are not messages', async () => {
    const source = makeSource(undefined, [own(channel, 'mentions')])
    const levels = await getApplicableNotifyLevels(source, channel, receiver, [own(channel, 'none')])
    expect(levels).toEqual(['none'])
    expect(source.findRestrictedContexts).not.toHaveBeenCalled()
  })

  it('blocks a mention in a thread (edited reply) when the channel level is none', async () => {
    const source = makeSource(thread(channel), [own(channel, 'none')])
    const levels = await getApplicableNotifyLevels(source, rootMessage, receiver, [])
    expect(levels).toEqual([undefined, 'none'])
    expect(isAllowedByNotifyLevels(levels, isMentionClass)).toBe(false)
  })

  it('allows only mentions in a thread when the channel level is mentions', async () => {
    const source = makeSource(thread(channel), [own(channel, 'mentions')])
    const levels = await getApplicableNotifyLevels(source, rootMessage, receiver, [])
    expect(isAllowedByNotifyLevels(levels, isMentionClass)).toBe(true)
    expect(isAllowedByNotifyLevels(levels, () => false)).toBe(false)
  })

  it('always resolves the parent by id and uses its persisted channel', async () => {
    const source = makeSource(thread(channel), [own(channel, 'none')])
    const levels = await getApplicableNotifyLevels(source, rootMessage, receiver, [])
    expect(source.findParentMessage).toHaveBeenCalledWith(rootMessage)
    expect(source.findRestrictedContexts).toHaveBeenCalledWith(channel)
    expect(levels).toEqual([undefined, 'none'])
  })

  it('does not inherit from a persisted parent that is not a thread parent', async () => {
    const parent: PersistedParentMessage = { ...thread(channel), _class: 'core:class:Doc' as Ref<Class<Doc>> }
    const source = makeSource(parent, [own(channel, 'none')])
    expect(await getApplicableNotifyLevels(source, rootMessage, receiver, [])).toEqual([undefined])
  })

  it('ignores a channel context of another space', async () => {
    const foreign: NotifyLevelContext = { ...own(channel, 'none'), space: 'space-x' as Ref<PersonSpace> }
    const source = makeSource(thread(channel), [foreign])
    const levels = await getApplicableNotifyLevels(source, rootMessage, receiver, [])
    expect(levels).toEqual([undefined, undefined])
  })

  it('handles a missing or self-referencing parent message', async () => {
    const missing = makeSource(undefined, [own(channel, 'none')])
    expect(await getApplicableNotifyLevels(missing, rootMessage, receiver, [])).toEqual([undefined])

    const selfRef = makeSource(thread(rootMessage), [own(rootMessage, 'none')])
    expect(await getApplicableNotifyLevels(selfRef, rootMessage, receiver, [])).toEqual([undefined])
    expect(selfRef.findRestrictedContexts).not.toHaveBeenCalled()

    const noChannel = makeSource(thread(undefined), [own(channel, 'none')])
    expect(await getApplicableNotifyLevels(noChannel, rootMessage, receiver, [])).toEqual([undefined])
  })

  it('keeps the thread own level together with the channel level', async () => {
    const source = makeSource(thread(channel), [own(channel, 'mentions')])
    const levels = await getApplicableNotifyLevels(source, rootMessage, receiver, [own(rootMessage, 'none')])
    expect(levels).toEqual(['none', 'mentions'])
  })
})
