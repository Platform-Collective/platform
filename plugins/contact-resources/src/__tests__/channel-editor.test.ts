// SPDX-License-Identifier: EPL-2.0

import contact, { type Channel, type Person } from '@hcengineering/contact'
import core, { generateId, type Data } from '@hcengineering/core'
import { canDeleteChannel, deleteChannel, updateChannelCanDelete } from '../channel-editor'

const channelData: Data<Channel> = {
  attachedTo: generateId<Person>(),
  attachedToClass: contact.class.Person,
  collection: 'channels',
  provider: contact.channelProvider.Email,
  value: 'person@example.com'
}

function createChannel (): Channel {
  return {
    ...channelData,
    _id: generateId<Channel>(),
    _class: contact.class.Channel,
    space: core.space.Space,
    modifiedOn: 0,
    modifiedBy: core.account.System
  }
}

describe('canDeleteChannel', () => {
  it('hides deletion for a saved channel when the document check forbids it', async () => {
    const channel = createChannel()
    const canDelete = jest.fn().mockResolvedValue(false)

    await expect(canDeleteChannel(channel, canDelete)).resolves.toBe(false)
    expect(canDelete).toHaveBeenCalledWith(channel)
  })

  it('keeps unsaved channels deletable without a document permission check', async () => {
    const canDelete = jest.fn()

    await expect(canDeleteChannel(channelData, canDelete)).resolves.toBe(true)
    expect(canDelete).not.toHaveBeenCalled()
  })
})

describe('updateChannelCanDelete', () => {
  it('ignores a stale permission result after the displayed channel changes', async () => {
    const previous = createChannel()
    const next = createChannel()
    let current = previous
    let resolvePrevious: (allowed: boolean) => void = () => undefined
    const previousPermission = new Promise<boolean>((resolve) => {
      resolvePrevious = resolve
    })
    const canDelete = jest.fn(async (channel: Channel): Promise<boolean> => {
      return channel === previous ? previousPermission : Promise.resolve(false)
    })
    const states: boolean[] = []
    const setCanDelete = (allowed: boolean): void => {
      states.push(allowed)
    }

    const previousUpdate = updateChannelCanDelete(previous, () => current, canDelete, setCanDelete)
    current = next
    await updateChannelCanDelete(next, () => current, canDelete, setCanDelete)
    resolvePrevious(true)
    await previousUpdate

    expect(states).toEqual([false, false, false])
  })
})

describe('deleteChannel', () => {
  const event = new Event('click')
  const allowDelete = jest.fn().mockResolvedValue(true)

  it('invokes the delete action for a saved channel and closes the editor', async () => {
    const channel = createChannel()
    const action = { _id: 'delete' }
    const invoke = jest.fn()
    const dispatch = jest.fn()
    const getAction = jest.fn().mockReturnValue(action)

    await deleteChannel(channel, event, invoke, dispatch, allowDelete, getAction)

    expect(getAction).toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith(channel, event, action)
    expect(dispatch).toHaveBeenCalledWith('close')
  })

  it('handles a rejected delete action without closing the editor', async () => {
    const channel = createChannel()
    const invoke = jest.fn().mockRejectedValue(new Error('delete failed'))
    const dispatch = jest.fn()
    const getAction = jest.fn().mockReturnValue({ _id: 'delete' })

    await expect(deleteChannel(channel, event, invoke, dispatch, allowDelete, getAction)).resolves.toBeUndefined()

    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does not look up or invoke an action when the document check forbids deletion', async () => {
    const channel = createChannel()
    const invoke = jest.fn()
    const dispatch = jest.fn()
    const canDelete = jest.fn().mockResolvedValue(false)
    const getAction = jest.fn()

    await deleteChannel(channel, event, invoke, dispatch, canDelete, getAction)

    expect(canDelete).toHaveBeenCalledWith(channel)
    expect(getAction).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('closes a saved channel editor when the delete action is unavailable', async () => {
    const invoke = jest.fn()
    const dispatch = jest.fn()
    const getAction = jest.fn().mockReturnValue(undefined)

    await deleteChannel(createChannel(), event, invoke, dispatch, allowDelete, getAction)

    expect(invoke).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith('close')
  })

  it('removes an unsaved channel locally without a document action or permission check', async () => {
    const invoke = jest.fn()
    const dispatch = jest.fn()
    const canDelete = jest.fn()
    const getAction = jest.fn()

    await deleteChannel(channelData, event, invoke, dispatch, canDelete, getAction)

    expect(canDelete).not.toHaveBeenCalled()
    expect(getAction).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledWith('close', '')
  })
})
