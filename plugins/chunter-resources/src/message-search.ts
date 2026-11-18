// SPDX-License-Identifier: EPL-2.0

import type { ChatMessage } from '@hcengineering/chunter'
import { type DocumentQuery, type FindOptions, SortingOrder } from '@hcengineering/core'

const PAGE_SIZE = 100

export interface MessageSearchState {
  messages: ChatMessage[]
  loading: boolean
  hasMore: boolean
}

export type FindMessages = (
  query: DocumentQuery<ChatMessage>,
  options: FindOptions<ChatMessage>
) => Promise<ChatMessage[]>

export class MessageSearch {
  private version = 0
  private limit = PAGE_SIZE
  private query: DocumentQuery<ChatMessage> = {}
  private destroyed = false
  private state: MessageSearchState = { messages: [], loading: false, hasMore: false }

  constructor (
    private readonly find: FindMessages,
    private readonly publish: (state: MessageSearchState) => void,
    private readonly onError: (error: unknown) => void
  ) {}

  async setQuery (query: DocumentQuery<ChatMessage>): Promise<void> {
    if (this.destroyed) return
    this.query = query
    this.limit = PAGE_SIZE
    this.version++
    this.setState({ messages: [], loading: false, hasMore: false })
    await this.load(PAGE_SIZE)
  }

  async loadMore (): Promise<void> {
    if (this.destroyed || this.state.loading || !this.state.hasMore) return
    await this.load(this.limit + PAGE_SIZE)
  }

  private setState (state: MessageSearchState): void {
    this.state = state
    this.publish(state)
  }

  private async load (limit: number): Promise<void> {
    const version = this.version
    this.setState({ ...this.state, loading: true })
    try {
      // findAll has no offset. Refresh a growing, stably ordered window so
      // equal timestamps and changes between pages cannot duplicate rows.
      // Full-text searches retain the service's existing 5,000-candidate limit;
      // date/sender conditions are applied by its final database query.
      const messages = await this.find(this.query, {
        sort: { createdOn: SortingOrder.Descending, _id: SortingOrder.Descending },
        limit: limit + 1
      })
      if (this.destroyed || version !== this.version) return
      this.limit = limit
      this.setState({ messages: messages.slice(0, limit), loading: false, hasMore: messages.length > limit })
    } catch (error) {
      if (this.destroyed || version !== this.version) return
      this.setState({ ...this.state, loading: false })
      this.onError(error)
    }
  }

  destroy (): void {
    this.destroyed = true
    this.version++
  }
}
