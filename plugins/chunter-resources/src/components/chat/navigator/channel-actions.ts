// SPDX-License-Identifier: EPL-2.0

import type { Channel } from '@hcengineering/chunter'
import type { Doc, Hierarchy } from '@hcengineering/core'
import type { Action } from '@hcengineering/ui'
import view from '@hcengineering/view'
import { canArchiveSpace } from '@hcengineering/view-resources'
import { ArchiveChannel } from '../../../index'
import chunter from '../../../plugin'

export async function getChannelArchiveActions (object: Doc, hierarchy: Hierarchy): Promise<Action[]> {
  if (!hierarchy.isDerived(object._class, chunter.class.Channel)) {
    return []
  }

  const channel = object as Channel
  if (channel.archived) {
    return []
  }

  if (!(await canArchiveSpace(channel))) {
    return []
  }

  return [
    {
      icon: view.icon.Archive,
      label: chunter.string.ArchiveChannel,
      group: 'remove',
      action: async (_: unknown, evt: Event) => {
        await ArchiveChannel(channel, evt)
      }
    }
  ]
}
