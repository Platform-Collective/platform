<!--
// Copyright © 2023 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import chunter, { ChatMessage } from '@hcengineering/chunter'
  import { DocumentQuery } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import ui, { Button, Label, Loading, Scroller, SearchEdit } from '@hcengineering/ui'
  import { FilterBar, FilterButton } from '@hcengineering/view-resources'
  import { ActivityMessagePresenter } from '@hcengineering/activity-resources'

  import { setPlatformStatus, unknownError } from '@hcengineering/platform'
  import { deepEqual } from 'fast-equals'
  import { onDestroy } from 'svelte'

  import { MessageSearch, type MessageSearchState } from '../../../message-search'
  import plugin from '../../../plugin'
  import { openMessageFromSpecial } from '../../../navigation'

  export let withHeader: boolean = true
  export let search: string = ''

  const client = getClient()
  let state: MessageSearchState = { messages: [], loading: false, hasMore: false }
  const results = new MessageSearch(
    async (query, options) => await client.findAll(chunter.class.ChatMessage, query, options),
    (next) => (state = next),
    (error) => {
      void setPlatformStatus(unknownError(error))
    }
  )

  // Empty text must use the database directly, including for date-only searches.
  $: searchQuery = search.trim() === '' ? {} : { $search: search }
  let resultQuery: DocumentQuery<ChatMessage> | undefined
  $: if (resultQuery !== undefined) void results.setQuery(resultQuery)

  function updateQuery(query: DocumentQuery<ChatMessage>): void {
    if (!deepEqual(query, resultQuery)) resultQuery = query
  }

  onDestroy(() => results.destroy())
</script>

{#if withHeader}
  <div class="ac-header full divide">
    <div class="ac-header__wrap-title">
      <span class="ac-header__title"><Label label={plugin.string.MessagesBrowser} /></span>
    </div>
    <SearchEdit bind:value={search} />
    <FilterButton _class={chunter.class.ChatMessage} />
  </div>
{/if}
<FilterBar
  _class={chunter.class.ChatMessage}
  space={undefined}
  query={searchQuery}
  on:change={(e) => updateQuery(e.detail)}
  hideSaveButtons
/>
{#if state.messages.length > 0}
  <Scroller padding={'1rem 0'} bottomPadding={'1rem'}>
    {#each state.messages as message (message._id)}
      <ActivityMessagePresenter
        value={message}
        onClick={() => {
          openMessageFromSpecial(message)
        }}
      />
    {/each}
    {#if state.hasMore}
      <div class="flex-center p-4">
        <Button label={ui.string.ShowMore} disabled={state.loading} on:click={() => results.loadMore()} />
      </div>
    {/if}
  </Scroller>
{:else if state.loading}
  <Loading />
{:else}
  <div class="flex-center h-full text-lg">
    <Label label={plugin.string.NoResults} />
  </div>
{/if}
