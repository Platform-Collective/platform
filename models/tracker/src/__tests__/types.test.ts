// SPDX-License-Identifier: EPL-2.0

import activity from '@hcengineering/activity'
import communication from '@hcengineering/communication'
import core, { TxProcessor, type Doc, type TxCreateDoc } from '@hcengineering/core'
import { Builder } from '@hcengineering/model'
import {
  addEventListener,
  addStringsLoader,
  PlatformEvent,
  removeEventListener,
  translate
} from '@hcengineering/platform'
import { trackerId } from '@hcengineering/tracker'
import view from '@hcengineering/view'

import { createActions } from '../actions'
import tracker from '../plugin'
import { TMilestone, TypeMilestoneStatus } from '../types'

describe('Milestone status type', () => {
  it('keeps the milestone status type with a localized label', () => {
    expect(TypeMilestoneStatus()).toEqual({
      _class: tracker.class.TypeMilestoneStatus,
      label: tracker.string.Status
    })
  })

  it('translates the generated status attribute type label without a platform error', async () => {
    const builder = new Builder()
    builder.createModel(TMilestone)
    const attribute = builder.hierarchy.getAttribute(tracker.class.Milestone, 'status')
    const onStatus = jest.fn().mockResolvedValue(undefined)
    addStringsLoader(
      trackerId,
      async (locale) => await import(`../../../../plugins/tracker-assets/lang/${locale}.json`)
    )
    addEventListener(PlatformEvent, onStatus)

    try {
      expect(attribute.type._class).toBe(tracker.class.TypeMilestoneStatus)
      expect(await translate(attribute.type.label, {}, 'en')).toBe('Status')
      expect(onStatus).not.toHaveBeenCalled()
    } finally {
      removeEventListener(PlatformEvent, onStatus)
    }
  })
})

describe('create issue from a message registration', () => {
  it('registers the context menu and communication actions with their resource IDs', () => {
    const builder = new Builder()
    createActions(builder, 'issues', 'components', 'myIssues')
    const docs = builder
      .getTxes()
      .filter((tx): tx is TxCreateDoc<Doc> => tx._class === core.class.TxCreateDoc)
      .map((tx) => TxProcessor.createDoc2Doc(tx))

    expect(docs).toContainEqual(
      expect.objectContaining({
        _class: view.class.Action,
        label: tracker.string.CreateIssueFromMessage,
        target: activity.class.ActivityMessage,
        action: tracker.actionImpl.CreateIssueFromMessage,
        visibilityTester: tracker.function.CanCreateIssueFromMessage
      })
    )
    expect(docs).toContainEqual(
      expect.objectContaining({
        _id: tracker.messageAction.CreateIssue,
        _class: communication.class.MessageAction,
        label: tracker.string.CreateIssueFromMessage,
        action: tracker.messageActionImpl.CreateIssue,
        visibilityTester: tracker.function.CanCreateIssueFromCommunicationMessage,
        menu: true
      })
    )
  })
})
