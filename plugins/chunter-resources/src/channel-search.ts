// SPDX-License-Identifier: EPL-2.0

import chunter, { type Channel } from '@hcengineering/chunter'
import type { Client, DocumentQuery, RelatedDocument, WithLookup } from '@hcengineering/core'

export function getChannelSearchQuery (
  search: string,
  filter?: { in?: RelatedDocument[], nin?: RelatedDocument[] }
): DocumentQuery<Channel> {
  const query: DocumentQuery<Channel> = { name: { $like: `%${search}%` } }
  if (filter?.in !== undefined || filter?.nin !== undefined) {
    query._id = {}
    if (filter.in !== undefined) {
      query._id.$in = filter.in.map((item) => item._id as Channel['_id'])
    }
    if (filter.nin !== undefined) {
      query._id.$nin = filter.nin.map((item) => item._id as Channel['_id'])
    }
  }

  return query
}

export async function queryChannels (
  client: Client,
  search: string,
  filter?: { in?: RelatedDocument[], nin?: RelatedDocument[] }
): Promise<Array<WithLookup<Channel>>> {
  return await client.findAll(chunter.class.Channel, getChannelSearchQuery(search, filter), { limit: 200 })
}
