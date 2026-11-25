// SPDX-License-Identifier: EPL-2.0

import core, { TxProcessor, type TxCreateDoc } from '@hcengineering/core'
import { Builder } from '@hcengineering/model'
import type { Action } from '@hcengineering/view'
import { createActions } from '../actions'
import tracker from '../plugin'

it('registers mark-as-duplicate with its own icon and visibility tester', () => {
  const builder = new Builder()
  createActions(builder, 'issues', 'components', 'my-issues')

  const tx = builder.getTxes().find(
    (candidate): candidate is TxCreateDoc<Action> =>
      candidate._class === core.class.TxCreateDoc && candidate.objectId === tracker.action.MarkAsDuplicate
  )
  if (tx === undefined) throw new Error('Mark-as-duplicate action was not registered')
  const action = TxProcessor.createDoc2Doc(tx)

  expect(action).toEqual(
    expect.objectContaining({
      _id: tracker.action.MarkAsDuplicate,
      target: tracker.class.Issue,
      icon: tracker.icon.Relations,
      visibilityTester: tracker.function.CanMarkIssueDuplicate
    })
  )
  expect(action.actionProps).toEqual(
    expect.objectContaining({
      component: tracker.component.MarkIssueDuplicatePopup,
      fillProps: { _object: 'value' }
    })
  )
})
