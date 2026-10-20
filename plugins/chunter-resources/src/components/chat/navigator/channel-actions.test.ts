// SPDX-License-Identifier: EPL-2.0

import type { Channel } from '@hcengineering/chunter'
import { Hierarchy } from '@hcengineering/core'
import view from '@hcengineering/view'
import { canArchiveSpace } from '@hcengineering/view-resources'
import { ArchiveChannel } from '../../../index'
import chunter from '../../../plugin'
import { getChannelArchiveActions } from './channel-actions'

jest.mock('@hcengineering/view-resources', () => ({ canArchiveSpace: jest.fn() }))
jest.mock('../../../index', () => ({ ArchiveChannel: jest.fn() }))

describe('getChannelArchiveActions', () => {
  const channel = {
    _id: 'channel',
    _class: chunter.class.Channel,
    archived: false
  } as unknown as Channel
  const hierarchy = new Hierarchy()
  const isDerived = jest.spyOn(hierarchy, 'isDerived')

  beforeEach(() => {
    jest.clearAllMocks()
    isDerived.mockImplementation((_class, base) => _class === base)
    jest.mocked(canArchiveSpace).mockResolvedValue(true)
  })

  it('offers Archive channel when the existing visibility rule allows it', async () => {
    const actions = await getChannelArchiveActions(channel, hierarchy)

    expect(actions).toEqual([
      {
        label: chunter.string.ArchiveChannel,
        icon: view.icon.Archive,
        group: 'remove',
        action: expect.any(Function)
      }
    ])
    expect(canArchiveSpace).toHaveBeenCalledWith(channel)
    expect(ArchiveChannel).not.toHaveBeenCalled()

    const event = new Event('click')
    await actions[0].action([], event)
    expect(ArchiveChannel).toHaveBeenCalledWith(channel, event)
  })

  it('hides Archive channel for a member without archive permission', async () => {
    jest.mocked(canArchiveSpace).mockResolvedValue(false)

    expect(await getChannelArchiveActions(channel, hierarchy)).toEqual([])
    expect(canArchiveSpace).toHaveBeenCalledWith(channel)
    expect(ArchiveChannel).not.toHaveBeenCalled()
  })

  it('hides Archive channel for archived channels', async () => {
    const archivedChannel = { ...channel, archived: true }

    expect(await getChannelArchiveActions(archivedChannel, hierarchy)).toEqual([])
    expect(canArchiveSpace).not.toHaveBeenCalled()
  })

  it('checks archive permission when the archived field is missing', async () => {
    const object = { ...channel }
    Reflect.deleteProperty(object, 'archived')

    expect(await getChannelArchiveActions(object, hierarchy)).toHaveLength(1)
    expect(canArchiveSpace).toHaveBeenCalledWith(object)
  })

  it('does not offer Archive channel for direct messages or other objects', async () => {
    const directMessage = { ...channel, _class: chunter.class.DirectMessage }

    expect(await getChannelArchiveActions(directMessage, hierarchy)).toEqual([])
    expect(canArchiveSpace).not.toHaveBeenCalled()
  })

  it('supports derived channel classes', async () => {
    const derivedChannel = { ...channel, _class: 'channel-subclass' as Channel['_class'] }
    isDerived.mockReturnValue(true)

    expect(await getChannelArchiveActions(derivedChannel, hierarchy)).toHaveLength(1)
    expect(isDerived).toHaveBeenCalledWith(derivedChannel._class, chunter.class.Channel)
  })
})
