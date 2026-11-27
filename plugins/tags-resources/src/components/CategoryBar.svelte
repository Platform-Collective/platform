<!--
// Copyright © 2022 Hardcore Engineering Inc.
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
  import { Class, Doc, Ref, SortingOrder } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import { TagCategory, TagElement } from '@hcengineering/tags'
  import {
    Label,
    ModernButton,
    getPlatformColorForTextDef,
    showPopup,
    themeStore,
    ScrollerBar
  } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import tags from '../plugin'
  import { groupTagElements } from '../tag-category-groups'
  import type { TagCategoryGroup } from '../tag-category-groups'
  import { getTagStyle, TagElementInfo } from '../utils'
  import TagsCategoryPopup from './TagsCategoryPopup.svelte'

  export let targetClass: Ref<Class<Doc>>
  export let category: Ref<TagCategory> | undefined = undefined
  export let selected: Ref<TagElement>[] = []
  export let gap: 'none' | 'small' | 'big' = 'small'
  export let mode: 'item' | 'category' = 'category'
  export let tagElements: Map<Ref<TagElement>, TagElementInfo> | undefined

  let categories: TagCategory[] = []
  let visibleCategories: TagCategoryGroup[] = []

  const dispatch = createEventDispatcher()

  let elements: TagElement[] = []
  let scroller: HTMLElement

  const elementsQuery = createQuery()
  $: if (tagElements !== undefined && tagElements.size > 0) {
    elementsQuery.query(
      tags.class.TagElement,
      { _id: { $in: Array.from(tagElements?.keys()) }, targetClass },
      (res) => {
        elements = res
      },
      {
        sort: {
          title: SortingOrder.Ascending
        }
      }
    )
  } else {
    elementsQuery.unsubscribe()
    elements = []
  }

  $: visibleCategories = groupTagElements(categories, elements, tags.category.NoCategory).filter(
    (group) => group.elements.length > 0
  )

  $: if (selected.length > 0 && category === undefined) {
    category = visibleCategories.find((group) => group.elements.some((element) => selected.includes(element._id)))?._id
  }

  const categoriesQuery = createQuery()
  $: categoriesQuery.query(
    tags.class.TagCategory,
    {
      targetClass
    },
    (res) => {
      categories = res
    },
    { sort: { label: SortingOrder.Ascending } }
  )

  $: dispatch('categories', { categories, visibleCategories })

  const selectItem = (item: TagCategoryGroup): void => {
    if (category === item._id) {
      category = undefined
    } else {
      category = item._id
    }
    selected = category !== undefined ? item.elements.map((it) => it._id) : []
    dispatch('change', { category, elements: selected })
  }

  function selectTag(evt: Event, category: TagCategoryGroup): void {
    showPopup(
      TagsCategoryPopup,
      {
        category,
        targetClass,
        selected,
        keyLabel: category.label ?? '',
        hideAdd: true
      },
      evt.target as HTMLElement,
      (result) => {
        if (result !== undefined) {
          selected = result.map((it: TagElement) => it._id)
          dispatch('change', { category: category._id, elements: result })
        }
      }
    )
  }
  const visibleCategoriesRef: HTMLElement[] = []

  $: visibleCategoriesRef.length = visibleCategories.length

  $: if (category !== undefined && visibleCategories.length > 0 && visibleCategoriesRef.length > 0) {
    const idx = visibleCategories.findIndex((it) => it._id === category)
    if (idx !== -1) {
      visibleCategoriesRef[idx]?.scrollIntoView({ block: 'nearest' })
    }
  }
</script>

{#if visibleCategories.length > 1 || category !== undefined}
  <div class="hulyHeader-container clearPadding justify-between flex-gap-4">
    <ModernButton
      label={tags.string.AllCategories}
      kind={'tertiary'}
      size={'small'}
      on:click={() => {
        category = undefined
        selected = []
        dispatch('change', { category, elements: [] })
      }}
    />
    <ScrollerBar bind:scroller {gap}>
      {#each visibleCategories as item, i}
        {@const color = getPlatformColorForTextDef(item.label ?? '', $themeStore.dark)}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
          bind:this={visibleCategoriesRef[i]}
          class="categoryElement flex-center"
          id={item.label}
          style={getTagStyle(color, item._id === category)}
          on:click={(evt) => {
            if (mode === 'category') {
              selectItem(item)
            } else {
              selectTag(evt, item)
            }
          }}
        >
          {#if item.label !== undefined}{item.label}{:else}<Label label={tags.string.OtherCategoryLabel} />{/if}
          {#if item._id === category && mode === 'item'}
            ({selected.length}/{item.elements.length})
          {:else}
            ({item.elements.length})
          {/if}
        </div>
      {/each}
    </ScrollerBar>
  </div>
{/if}

<style lang="scss">
  .categoryElement {
    padding: 0.375rem 0.75rem;
    // height: 2.5rem;
    white-space: nowrap;
    border: 1px solid var(--divider-color);
    border-radius: 0.375rem;
    cursor: pointer;
  }
  .categoryElement + .categoryElement {
    margin-left: 0.125rem;
  }
</style>
