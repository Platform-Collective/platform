<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { type DocumentQuery, type Ref, type Space, type WithLookup } from '@hcengineering/core'
  import { type GitlabMergeRequest } from '@hcengineering/gitlab'
  import { type IntlString, translateCB } from '@hcengineering/platform'
  import { type IModeSelector, themeStore } from '@hcengineering/ui'
  import { type ViewOptions, type Viewlet } from '@hcengineering/view'
  import { FilterBar, SpaceHeader, ViewletContentView, ViewletSettingButton } from '@hcengineering/view-resources'
  import gitlab from '../plugin'

  export let space: Ref<Space> | undefined = undefined
  export let query: DocumentQuery<GitlabMergeRequest> = {}
  export let title: IntlString | undefined = undefined
  export let label: string = ''
  export let modeSelectorProps: IModeSelector | undefined = undefined

  let viewlet: WithLookup<Viewlet> | undefined = undefined
  const viewlets: Array<WithLookup<Viewlet>> = []
  let viewOptions: ViewOptions | undefined
  let search = ''
  let searchQuery: DocumentQuery<GitlabMergeRequest> = { ...query }
  let resultQuery: DocumentQuery<GitlabMergeRequest> = { ...searchQuery }

  function updateSearchQuery(search: string): void {
    searchQuery = search === '' ? { ...query } : { ...query, $search: search }
  }
  $: if (query !== undefined) updateSearchQuery(search)

  // The title follows the UI language; a label passed in wins
  let translatedTitle = ''
  $: if (title !== undefined) {
    translateCB(title, {}, $themeStore.language, (res) => {
      translatedTitle = res
    })
  }
  $: shownLabel = label !== '' ? label : translatedTitle
</script>

<SpaceHeader
  bind:viewlet
  bind:search
  _class={gitlab.class.GitlabMergeRequest}
  {viewlets}
  label={shownLabel}
  {space}
  {modeSelectorProps}
>
  <svelte:fragment slot="header-tools">
    <ViewletSettingButton bind:viewOptions bind:viewlet />
  </svelte:fragment>
</SpaceHeader>
{#if viewlet !== undefined && viewOptions !== undefined}
  <FilterBar
    _class={gitlab.class.GitlabMergeRequest}
    query={searchQuery}
    {space}
    {viewOptions}
    on:change={(e) => (resultQuery = e.detail)}
  />
  <div class="popupPanel rowContent">
    <ViewletContentView _class={gitlab.class.GitlabMergeRequest} {viewlet} query={resultQuery} {space} {viewOptions} />
  </div>
{/if}
