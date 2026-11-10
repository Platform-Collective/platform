// SPDX-License-Identifier: EPL-2.0

import chunter, { type Channel } from '@hcengineering/chunter'
import type { Client, Ref, RelatedDocument, WithLookup } from '@hcengineering/core'

import { queryChannels } from '../channel-search'

const channel = (id: string): RelatedDocument => ({
  _id: id as Ref<Channel>,
  _class: chunter.class.Channel
})

describe('queryChannels', () => {
  it('requests matching channels with the supplied inclusion and exclusion filters', async () => {
    const matchingChannel = { _id: 'channel-one', name: 'engineering' } as unknown as WithLookup<Channel>
    const findAll = jest.fn().mockResolvedValue([matchingChannel])
    const client = { findAll } as unknown as Client

    await expect(
      queryChannels(client, 'engineering', { in: [channel('one')], nin: [channel('two')] })
    ).resolves.toEqual([matchingChannel])
    expect(findAll).toHaveBeenCalledWith(
      chunter.class.Channel,
      {
        name: { $like: '%engineering%' },
        archived: false,
        _id: { $in: ['one'], $nin: ['two'] }
      },
      { limit: 200 }
    )
  })

  it('matches LIKE wildcard characters in the search text literally', async () => {
    const literal = { _id: 'channel-literal', name: 'Release_Notes' } as unknown as WithLookup<Channel>
    const wildcard = { _id: 'channel-wildcard', name: 'releaseXnotes' } as unknown as WithLookup<Channel>
    const percent = { _id: 'channel-percent', name: '100% done' } as unknown as WithLookup<Channel>
    const findAll = jest.fn().mockResolvedValue([literal, wildcard, percent])
    const client = { findAll } as unknown as Client

    await expect(queryChannels(client, 'release_notes')).resolves.toEqual([literal])
    await expect(queryChannels(client, '0% d')).resolves.toEqual([percent])
  })
})
