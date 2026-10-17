import type { Class, Doc, DocumentQuery, FindOptions, FindResult, Ref } from '@hcengineering/core'
import type { ResultArray } from './results'

export type Callback = (result: FindResult<Doc>) => void

export type QueryId = number
export interface Query {
  id: QueryId // uniq query identifier.
  _class: Ref<Class<Doc>>
  query: DocumentQuery<Doc>
  result: ResultArray | Promise<ResultArray>
  options?: FindOptions<Doc>
  total: number
  callbacks: Map<string, Callback>
  refresh: () => Promise<void>
  refreshId: number
  // False while the whole result still has to be registered in Refs. Documents that enter the
  // result one at a time are registered on the spot, so the full walk is only for a fresh result.
  refsRegistered: boolean
}
