// SPDX-License-Identifier: EPL-2.0

import type { Person } from '@hcengineering/contact'
import { getCurrentAccount } from '@hcengineering/core'
import login from '@hcengineering/login'
import { getResource } from '@hcengineering/platform'
import { MessageBox, getClient } from '@hcengineering/presentation'
import { showPopup } from '@hcengineering/ui'
import contact from './plugin'

function isCurrentAccount (doc: Person): boolean {
  return doc.personUuid === getCurrentAccount().uuid
}

/** Removing yourself would log you out of the workspace for good, so the action is hidden for your own person. */
export async function canKickEmployee (doc: Person): Promise<boolean> {
  return !isCurrentAccount(doc)
}

export async function kickEmployee (doc: Person): Promise<void> {
  if (isCurrentAccount(doc)) {
    return
  }

  showPopup(MessageBox, {
    label: contact.string.KickEmployee,
    message: contact.string.KickEmployeeDescr,
    action: async () => {
      const client = getClient()

      const employee = client.getHierarchy().as(doc, contact.mixin.Employee)
      await client.update(employee, { active: false })

      if (doc.personUuid != null) {
        const leaveWorkspace = await getResource(login.function.LeaveWorkspace)
        await leaveWorkspace(doc.personUuid)
      }
    }
  })
}
