<!-- Copyright © 2025 Hardcore Engineering Inc. -->
<!-- -->
<!-- Licensed under the Eclipse Public License, Version 2.0 (the "License"); -->
<!-- you may not use this file except in compliance with the License. You may -->
<!-- obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0 -->
<!-- -->
<!-- Unless required by applicable law or agreed to in writing, software -->
<!-- distributed under the License is distributed on an "AS IS" BASIS, -->
<!-- WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. -->
<!-- -->
<!-- See the License for the specific language governing permissions and -->
<!-- limitations under the License. -->

<script lang="ts">
  import { Label, ListView, Loading, Scroller } from '@hcengineering/ui'
  import { Doc, Ref } from '@hcengineering/core'
  import { createEventDispatcher, tick } from 'svelte'
  import { Analytics } from '@hcengineering/analytics'
  import notification, {
    ActivityNotificationViewlet,
    DocNotifyContext,
    InboxNotification
  } from '@hcengineering/notification'
  import { Notification } from '@hcengineering/communication-types'
  import { getClient } from '@hcengineering/presentation'
  import { InboxNotificationsClientImpl } from '@hcengineering/notification-resources'
  import view from '@hcengineering/view'

  import inbox from '../plugin'
  import { NavigationItem } from '../type'
  import { NavigationClient } from '../client'
  import InboxCard from './InboxCard.svelte'

  export let doc: Doc | undefined = undefined
  export let legacyContext: DocNotifyContext | undefined = undefined

  const dispatch = createEventDispatcher<{
    select: {
      navItem: NavigationItem
      doc: Doc
      notification?: InboxNotification | Notification
    }
    clear: void
  }>()
  const client = getClient()

  const navClient: NavigationClient = new NavigationClient(InboxNotificationsClientImpl.getClient())
  const navigationItemsStore = navClient.navigationItemsStore
  const isLoadingStore = navClient.isLoadingStore

  let navItems: NavigationItem[] = []

  $: navItems = $navigationItemsStore

  let divScroll: HTMLElement | undefined | null = undefined
  let contentDiv: HTMLElement | undefined | null = undefined

  let list: ListView
  let listSelection = 0

  let viewlets: ActivityNotificationViewlet[] = []

  void client.findAll(notification.class.ActivityNotificationViewlet, {}).then((res) => {
    viewlets = res
  })

  let isPrevPageLoading = false

  function handleScroll(): void {
    if (divScroll != null && navClient.hasPrevPage() && !isPrevPageLoading) {
      const isAtBottom = divScroll.scrollTop + divScroll.clientHeight >= divScroll.scrollHeight - 10
      if (isAtBottom) {
        isPrevPageLoading = true
        void navClient.prev().then(() => {
          isPrevPageLoading = false
        })
      }
    }
  }

  const docById = new Map<Ref<Doc>, Doc>()

  let removingItem: NavigationItem | undefined = undefined

  async function handleRemove(navItem: NavigationItem): Promise<void> {
    if (removingItem != null) return
    const index = navItems.indexOf(navItem)
    if (index < 0) return

    removingItem = navItem
    try {
      await navClient.remove(navItem)

      // Live queries may report the removal before or after the request completes.
      const contextId = navItem.type === 'modern' ? navItem.context.id : navItem.context._id
      navItems = navItems.filter((item) => {
        const itemContextId = item.type === 'modern' ? item.context.id : item.context._id
        return item.type !== navItem.type || itemContextId !== contextId
      })
      const selected =
        navItem.type === 'legacy' && legacyContext != null
          ? navItem.context._id === legacyContext._id
          : navItem._id === doc?._id
      if (!selected) {
        if (index < listSelection) listSelection--
        listSelection = Math.max(0, Math.min(listSelection, navItems.length - 1))
        return
      }
      listSelection = Math.max(0, Math.min(index, navItems.length - 1))
      const nextItem = navItems[listSelection]

      await tick()
      if (nextItem == null) {
        dispatch('clear')
        return
      }

      list.select(listSelection)
      const nextDoc = docById.get(nextItem._id) ?? (await client.findOne(nextItem._class, { _id: nextItem._id }))
      if (nextDoc != null) {
        dispatch('select', { navItem: nextItem, doc: nextDoc })
      } else {
        dispatch('clear')
      }
      contentDiv?.focus()
    } catch (err) {
      Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      removingItem = undefined
    }
  }

  async function onKeydown(key: KeyboardEvent): Promise<void> {
    if (key.code === 'ArrowUp') {
      key.stopPropagation()
      key.preventDefault()
      list.select(listSelection - 1)
    }
    if (key.code === 'ArrowDown') {
      key.stopPropagation()
      key.preventDefault()
      list.select(listSelection + 1)
    }
    if (key.code === 'Backspace') {
      key.preventDefault()
      key.stopPropagation()
      const navItem = navItems[listSelection]
      if (navItem != null) {
        await handleRemove(navItem)
      }
    }
    if (key.code === 'Enter') {
      key.preventDefault()
      key.stopPropagation()
      const navItem = navItems[listSelection]
      const doc = docById.get(navItem?._id)

      if (navItem != null && doc != null) {
        dispatch('select', {
          navItem,
          doc
        })
      }
    }
  }

  $: if (contentDiv != null) {
    contentDiv.focus()
  }

  function getContextKey(index: number): string {
    const item = navItems[index]
    if (item == null) return index.toString()

    // For legacy items, use the context's _id to ensure uniqueness
    if (item.type === 'legacy') {
      return `${item.context?._id}-${item._id}-${item.type}`
    }

    return `${item._id}-${item.type}`
  }
</script>

{#if navItems.length > 0}
  <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <Scroller bind:divScroll padding="0" shrink onScroll={handleScroll}>
    <div class="inbox-list" bind:this={contentDiv} tabindex="0" on:keydown={onKeydown}>
      <ListView
        bind:this={list}
        bind:selection={listSelection}
        count={navItems.length}
        items={navItems}
        highlightIndex={legacyContext
          ? navItems.findIndex((it) => it._id === legacyContext.objectId)
          : navItems.findIndex((it) => it._id === doc?._id)}
        noScroll
        kind="full-size"
        colorsSchema="lumia"
        lazy={true}
        minHeight="6.125rem"
        getKey={getContextKey}
      >
        <svelte:fragment slot="item" let:item={itemIndex}>
          {@const navItem = navItems[itemIndex]}
          {#if navItem}
            <InboxCard
              {navItem}
              {viewlets}
              isRemoving={removingItem === navItem}
              selected={navItem._id === legacyContext?.objectId || navItem._id === doc?._id}
              on:remove={() => handleRemove(navItem)}
              on:doc={(e) => {
                const d = e.detail
                if (d == null) return
                docById.set(d._id, d)
              }}
              on:select={(e) => {
                dispatch('select', { navItem, doc: e.detail.doc, notification: e.detail.notification })
                listSelection = itemIndex
              }}
            />
          {/if}
        </svelte:fragment>
      </ListView>
    </div>
    {#if isPrevPageLoading}
      <div class="loader">
        <Label label={view.string.Loading} />
      </div>
    {/if}
  </Scroller>
{:else if $isLoadingStore}
  <div class="placeholder">
    <Loading />
  </div>
{:else}
  <div class="placeholder">
    <div class="placeholder__header">
      <Label label={inbox.string.InboxIsClear} />
    </div>
    <span class="mb-4">
      <Label label={inbox.string.YouDontHaveAnyNewMessages} />
    </span>
  </div>
{/if}

<style lang="scss">
  .inbox-list {
    display: flex;
    flex-direction: column;
    width: 100%;

    &:focus {
      outline: 0;
    }

    :global(.list-item) {
      border-radius: 0;
    }
  }

  .placeholder {
    display: flex;
    align-self: center;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    height: inherit;
    width: 100%;
    gap: 0.5rem;

    &__header {
      font-weight: 600;
    }
  }

  .loader {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--global-secondary-TextColor);
    font-weight: 500;
    height: 5rem;
    min-height: 5rem;
  }
</style>
