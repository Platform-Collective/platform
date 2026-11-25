// SPDX-License-Identifier: EPL-2.0

import { Hierarchy } from '@hcengineering/core'
import type { Client, Space } from '@hcengineering/core'
import { showPanel } from '@hcengineering/ui'
import view from '@hcengineering/view'
import { getActions, invokeAction } from '@hcengineering/view-resources'

export async function openSpaceEditor (client: Client, projectedSpace: Space, event: Event): Promise<void> {
  const space = await client.findOne<Space>(projectedSpace._class, { _id: projectedSpace._id }, { showArchived: true })
  if (space === undefined) return

  const editAction = (await getActions(client, space)).find(
    (action) =>
      action.input === 'focus' &&
      action.visibilityTester !== undefined &&
      (action.context.group === 'edit' || action.context.group === 'associate')
  )
  if (editAction !== undefined) {
    await invokeAction(space, event, editAction)
    return
  }

  const editor = client.getHierarchy().classHierarchyMixin(space._class, view.mixin.ObjectEditor)?.editor
  showPanel(editor ?? view.component.EditDoc, space._id, Hierarchy.mixinOrClass(space), 'content')
}
