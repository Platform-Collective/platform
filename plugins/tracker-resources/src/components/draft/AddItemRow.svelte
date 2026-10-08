<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import contact, { type PermissionsStore } from '@hcengineering/contact'
  import { getCurrentAccount, toIdMap, type Ref } from '@hcengineering/core'
  import { getResource, translate } from '@hcengineering/platform'
  import { getClient } from '@hcengineering/presentation'
  import task from '@hcengineering/task'
  import { taskTypeStore } from '@hcengineering/task-resources'
  import { MAX_ITEM_TITLE_LENGTH, MAX_PROJECT_ITEMS, parseAddItemInput, type Project } from '@hcengineering/tracker'
  import { Icon, IconAdd, Label, themeStore } from '@hcengineering/ui'
  import { canCreateObject, restrictionStore } from '@hcengineering/view-resources'
  import { onDestroy, tick } from 'svelte'

  import { addItemAvailability } from '../../draft/addItem'
  import { createDraftItem, type DraftValues } from '../../draft/create'
  import { sharedItemCountStore } from '../../draft/itemCount'
  import { resolveDraftTarget } from '../../draft/target'
  import tracker from '../../plugin'
  import { activeProjects } from '../../utils'
  import AddItemSearch from './AddItemSearch.svelte'

  // The "Add item" row (GitHub Projects): typing a title and pressing Enter adds a draft item to the project, typing `#`
  // searches existing issues to bring into it. In a board it sits at the bottom of a column and the draft starts with the
  // values of that column (and swimlane).
  export let project: Ref<Project>
  // What the new draft starts with, e.g. the value of the column it is added in
  export let values: DraftValues | undefined = undefined
  export let compact: boolean = false
  // Whether the search results are listed above or below the input
  export let placement: 'above' | 'below' = 'above'
  // Puts the cursor in the input when the row appears (the row of a popup)
  export let autofocus: boolean = false

  const client = getClient()
  const hierarchy = client.getHierarchy()

  let permissions: PermissionsStore | undefined
  let unsubscribePermissions: (() => void) | undefined
  void getResource(contact.store.Permissions).then((store) => {
    unsubscribePermissions = store.subscribe((value) => {
      permissions = value
    })
  })
  onDestroy(() => {
    unsubscribePermissions?.()
  })

  $: countStore = sharedItemCountStore(project)
  $: currentProject = $activeProjects.get(project)

  // Task types that issues can be created of, like the type selector of the create issue form
  const descriptors = toIdMap(client.getModel().findAllSync(task.class.TaskTypeDescriptor, {}))
  $: target =
    currentProject !== undefined
      ? resolveDraftTarget(
        currentProject,
        $taskTypeStore.values(),
        (taskType) =>
          (descriptors.get(taskType.descriptor)?.allowCreate ?? false) &&
            hierarchy.isDerived(taskType.targetClass, tracker.class.Issue)
      )
      : undefined

  $: availability = addItemAvailability({
    readonly: $restrictionStore.readonly,
    role: getCurrentAccount().role,
    canCreate: permissions !== undefined ? canCreateObject(tracker.class.Issue, project, permissions) : true,
    itemCount: $countStore
  })

  let text = ''
  let inputElement: HTMLInputElement | undefined
  let search: AddItemSearch | undefined
  let busy = false
  let failed = false
  $: input = parseAddItemInput(text)
  $: enabled = availability === 'ok' && target !== undefined

  // The input is disabled until the project and its task types are known, so it takes the focus once it can
  let autofocused = false
  $: if (autofocus && enabled && inputElement !== undefined && !autofocused) {
    autofocused = true
    void tick().then(() => {
      inputElement?.focus()
    })
  }

  let placeholder = ''
  $: void translate(tracker.string.AddItemPlaceholder, {}, $themeStore.language).then((res) => {
    placeholder = res
  })

  async function submit (): Promise<void> {
    if (input.kind === 'search') {
      search?.pickSelected()
      return
    }
    if (input.kind !== 'draft' || !enabled || target === undefined || busy) return
    busy = true
    failed = false
    try {
      await createDraftItem(client, target, input.title, values)
      text = ''
    } catch (err: any) {
      Analytics.handleError(err)
      failed = true
    } finally {
      busy = false
    }
  }

  function onKeydown (ev: KeyboardEvent): void {
    // The keys of the input are not for the list behind it
    if (ev.isComposing) return
    switch (ev.key) {
      case 'Enter':
        ev.preventDefault()
        ev.stopPropagation()
        void submit()
        break
      case 'Escape':
        if (text !== '') {
          ev.preventDefault()
          ev.stopPropagation()
          text = ''
        } else {
          inputElement?.blur()
        }
        break
      case 'ArrowDown':
      case 'ArrowUp':
        if (input.kind === 'search') {
          ev.preventDefault()
          ev.stopPropagation()
          search?.move(ev.key === 'ArrowDown' ? 1 : -1)
        } else {
          ev.stopPropagation()
        }
        break
      default:
        ev.stopPropagation()
    }
  }
</script>

{#if availability !== 'readonly'}
  <div class="add-item" class:compact data-id="add-item-row">
    {#if placement === 'above' && input.kind === 'search' && currentProject !== undefined && enabled}
      <AddItemSearch
        bind:this={search}
        query={input.query}
        {project}
        projectType={currentProject.type}
        {placement}
        on:done={() => {
          text = ''
        }}
      />
    {/if}
    <div class="field" class:disabled={!enabled}>
      <span class="icon"><Icon icon={IconAdd} size={'small'} /></span>
      <input
        bind:this={inputElement}
        bind:value={text}
        type="text"
        class="input"
        data-id="add-item-input"
        aria-label={placeholder}
        {placeholder}
        disabled={!enabled}
        readonly={busy}
        autocomplete="off"
        spellcheck="false"
        on:keydown={onKeydown}
        on:input={() => {
          failed = false
        }}
      />
    </div>
    {#if placement === 'below' && input.kind === 'search' && currentProject !== undefined && enabled}
      <AddItemSearch
        bind:this={search}
        query={input.query}
        {project}
        projectType={currentProject.type}
        {placement}
        on:done={() => {
          text = ''
        }}
      />
    {/if}
    {#if input.kind === 'too-long'}
      <div class="error" role="alert" data-id="add-item-too-long">
        <Label label={tracker.string.AddItemTooLong} params={{ limit: MAX_ITEM_TITLE_LENGTH }} />
      </div>
    {:else if failed}
      <div class="error" role="alert" data-id="add-item-failed"><Label label={tracker.string.AddItemFailed} /></div>
    {:else if availability === 'limit'}
      <div class="error" role="alert" data-id="add-item-limit">
        <Label label={tracker.string.ProjectItemLimitReached} params={{ limit: MAX_PROJECT_ITEMS }} />
      </div>
    {/if}
  </div>
{/if}

<style lang="scss">
  .add-item {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    gap: 0.25rem;
    min-width: 0;
    padding: 0.375rem 1.5rem;
    border-top: 1px solid var(--theme-divider-color);
    background: var(--theme-bg-color);

    &.compact {
      padding: 0.25rem 0;
      border-top: none;
      background: transparent;
    }
  }
  .field {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    padding: 0 0.5rem;
    height: 2rem;
    border: 1px solid transparent;
    border-radius: 0.375rem;
    color: var(--theme-content-color);

    &:hover,
    &:focus-within {
      border-color: var(--theme-divider-color);
    }
    &.disabled {
      opacity: 0.6;
    }
  }
  .icon {
    display: flex;
    flex-shrink: 0;
  }
  .input {
    flex: 1 1 auto;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: none;
    outline: none;
    background: transparent;
    font: inherit;
    color: var(--theme-caption-color);

    &::placeholder {
      color: var(--theme-dark-color);
    }
  }
  .error {
    padding: 0 0.5rem;
    font-size: 0.75rem;
    color: var(--theme-error-color, #d73a49);
  }
</style>
