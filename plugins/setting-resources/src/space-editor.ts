// SPDX-License-Identifier: EPL-2.0

import { Analytics } from '@hcengineering/analytics'
import { Hierarchy } from '@hcengineering/core'
import type { Client, Space } from '@hcengineering/core'
import { errorToStatus, setPlatformStatus } from '@hcengineering/platform'
import { showPanel } from '@hcengineering/ui'
import view from '@hcengineering/view'
import { canEditSpace, filterAvailableActions, invokeAction } from '@hcengineering/view-resources'

async function openEditorForSpace (client: Client, projectedSpace: Space, event: Event): Promise<void> {
  const space = await client.findOne<Space>(projectedSpace._class, { _id: projectedSpace._id }, { showArchived: true })
  if (space === undefined) return

  const hierarchy = client.getHierarchy()
  const ancestors = hierarchy.getAncestors(space._class)
  const actions = client.getModel().findAllSync(view.class.Action, { 'context.mode': 'spaceEditor' })
  const editorClass = ancestors.find((ancestor) => actions.some((action) => action.target === ancestor))
  if (editorClass !== undefined) {
    const candidates = actions.filter((action) => action.target === editorClass)
    const available = await filterAvailableActions(candidates, client, space)
    if (available.length === 1) {
      await invokeAction(space, event, available[0])
    }
    return
  }

  if (!(await canEditSpace(space))) return

  const editor = hierarchy.classHierarchyMixin(space._class, view.mixin.ObjectEditor)?.editor
  if (editor !== undefined) {
    showPanel(editor, space._id, space._class, 'content')
  } else {
    showPanel(view.component.EditDoc, space._id, Hierarchy.mixinOrClass(space), 'content')
  }
}

export async function openSpaceEditor (client: Client, projectedSpace: Space, event: Event): Promise<void> {
  try {
    await openEditorForSpace(client, projectedSpace, event)
  } catch (err) {
    await setPlatformStatus(errorToStatus(err)).catch((reportError: unknown) => {
      Analytics.handleError(reportError instanceof Error ? reportError : new Error(String(reportError)))
    })
  }
}
