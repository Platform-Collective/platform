// SPDX-License-Identifier: EPL-2.0

import type { Channel } from '@hcengineering/contact'
import type { Data } from '@hcengineering/core'

type CanDelete = (channel: Channel) => Promise<boolean>

export async function canDeleteChannel (channel: Data<Channel> | Channel, canDelete: CanDelete): Promise<boolean> {
  if (!('_id' in channel)) return true
  try {
    return await canDelete(channel)
  } catch {
    return false
  }
}

export async function updateChannelCanDelete (
  next: Data<Channel> | Channel,
  getCurrentChannel: () => Data<Channel> | Channel,
  canDelete: CanDelete,
  setCanDelete: (allowed: boolean) => void
): Promise<void> {
  setCanDelete(!('_id' in next))
  const allowed = await canDeleteChannel(next, canDelete)
  if (getCurrentChannel() === next) setCanDelete(allowed)
}

export async function deleteChannel<TAction> (
  channel: Data<Channel> | Channel,
  event: Event,
  invoke: (channel: Channel, event: Event, action: TAction) => Promise<void>,
  dispatch: (event: 'close', detail?: string) => void,
  canDelete: CanDelete,
  getAction: () => TAction | undefined
): Promise<void> {
  if (!('_id' in channel)) {
    dispatch('close', '')
    return
  }
  if (!(await canDeleteChannel(channel, canDelete))) return
  const action = getAction()
  try {
    if (action !== undefined) await invoke(channel, event, action)
  } catch {
    return
  }
  dispatch('close')
}
