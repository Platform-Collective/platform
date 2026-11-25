// SPDX-License-Identifier: EPL-2.0

import chunter from '@hcengineering/chunter'
import core, { type TxCreateDoc } from '@hcengineering/core'
import { Builder } from '@hcengineering/model'
import notification from '@hcengineering/notification'
import view, { type Action } from '@hcengineering/view'

import { defineActions } from '../actions'

describe('chat notification actions', () => {
  it('registers the notification level selector for a single channel or direct message context', () => {
    const builder = new Builder()
    defineActions(builder)

    const actionTx = builder.getTxes().find((tx): tx is TxCreateDoc<Action> => {
      return (
        tx._class === core.class.TxCreateDoc &&
        tx.objectClass === view.class.Action &&
        (tx as TxCreateDoc<Action>).attributes.action === notification.actionImpl.SetDocNotifyLevel
      )
    })

    expect(actionTx).toBeDefined()
    expect(actionTx?.attributes).toMatchObject({
      actionPopup: notification.component.DocNotifyLevelSelector,
      input: 'focus',
      target: notification.class.DocNotifyContext,
      query: {
        objectClass: { $in: [chunter.class.Channel, chunter.class.DirectMessage] }
      }
    })
  })
})
