<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import type { Ref } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import type { ProjectType } from '@hcengineering/task'
  import type { Issue, Project } from '@hcengineering/tracker'
  import { draftQuery } from '@hcengineering/tracker'
  import { Label, showPopup, Spinner } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import { classifySearchResult, type SearchResultAction } from '../../draft/addItem'
  import tracker from '../../plugin'
  import { restoreIssue } from '../../archive/actions'
  import { activeProjects, canEditIssuesBatch } from '../../utils'
  import Move from '../issues/Move.svelte'

  // The search of the "Add item" row after a `#`: issues of every project the user can see, recent ones first when
  // nothing is typed. Picking one moves it into this project (an issue belongs to exactly one project, so it leaves the
  // other one) or restores it when it is an archived item of this project.
  export let query: string
  export let project: Ref<Project>
  export let projectType: Ref<ProjectType>
  // Where the list sits relative to the input, only for the order of its rows
  export let placement: 'above' | 'below' = 'above'

  const RESULT_LIMIT = 20
  const dispatch = createEventDispatcher()
  const textQuery = createQuery()
  const identifierQuery = createQuery()

  let found: Issue[] = []
  let byIdentifier: Issue[] = []
  let loaded = false
  let allowed = new Map<Ref<Issue>, boolean>()

  // `PROJ-12` is also looked up by identifier, the full text index may not know a just created issue
  $: identifier = /^\S+-\d+$/.test(query.trim()) ? query.trim() : undefined
  // Drafts are items of a project already and cannot be moved or added
  const notDraft = draftQuery(false)

  $: {
    loaded = false
    const text = query.trim()
    textQuery.query(
      tracker.class.Issue,
      { ...notDraft, ...(text !== '' ? { $search: text } : {}) } as any,
      (res) => {
        found = res
        loaded = true
      },
      { limit: RESULT_LIMIT, ...(text === '' ? { sort: { modifiedOn: -1 } } : {}) } as any
    )
  }
  $: if (identifier !== undefined) {
    identifierQuery.query(tracker.class.Issue, { ...notDraft, identifier }, (res) => {
      byIdentifier = res
    })
  } else {
    identifierQuery.unsubscribe()
    byIdentifier = []
  }

  $: results = ((): Issue[] => {
    const seen = new Set<string>()
    const list: Issue[] = []
    for (const issue of [...byIdentifier, ...found]) {
      if (seen.has(issue._id)) continue
      seen.add(issue._id)
      list.push(issue)
    }
    return list.slice(0, RESULT_LIMIT)
  })()

  $: void canEditIssuesBatch(results).then((res) => {
    allowed = res
  })

  $: actions = results.map((issue): SearchResultAction =>
    classifySearchResult(issue, {
      project,
      projectType,
      typeOfProject: (space) => $activeProjects.get(space)?.type,
      canEdit: (id) => allowed.get(id as Ref<Issue>) ?? false
    })
  )

  let selected = 0
  $: if (selected >= results.length) selected = Math.max(0, results.length - 1)

  /** Moves the highlight; called by the input of the row on the arrow keys. */
  export function move (delta: number): void {
    if (results.length === 0) return
    selected = (selected + delta + results.length) % results.length
  }

  /** Picks the highlighted issue; called by the input of the row on Enter. Returns whether there was something to pick. */
  export function pickSelected (): boolean {
    const issue = results[selected]
    if (issue === undefined) return false
    pick(issue, actions[selected])
    return true
  }

  function pick (issue: Issue, action: SearchResultAction | undefined): void {
    switch (action) {
      case 'restore':
        void restoreIssue(issue)
        dispatch('done')
        return
      case 'move':
        // The move dialog of the tracker does the work: it maps components and milestones and renumbers the issue
        showPopup(Move, { selected: issue, target: project }, 'top')
        dispatch('done')
        return
      default:
        // Already in this project, or it cannot be moved here: the row says why, nothing happens
        break
    }
  }

  const projectName = (issue: Issue): string => $activeProjects.get(issue.space)?.identifier ?? ''
</script>

<div class="add-item-search" class:below={placement === 'below'} data-id="add-item-search">
  {#if !loaded && results.length === 0}
    <div class="note"><Spinner size={'small'} /></div>
  {:else if results.length === 0}
    <div class="note"><Label label={tracker.string.AddItemNoIssues} /></div>
  {:else}
    <div class="list" role="listbox">
      {#each results as issue, i (issue._id)}
        {@const action = actions[i]}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div
          class="result"
          class:selected={i === selected}
          class:dimmed={action === 'in-project' || action === 'not-movable'}
          role="option"
          aria-selected={i === selected}
          aria-disabled={action === 'in-project' || action === 'not-movable'}
          data-id="add-item-result"
          data-action={action}
          on:mousedown|preventDefault={() => {
            selected = i
            pick(issue, action)
          }}
          on:mousemove={() => {
            selected = i
          }}
        >
          <span class="identifier">{issue.identifier}</span>
          <span class="title">{issue.title}</span>
          {#if issue.space !== project && projectName(issue) !== ''}
            <span class="project">{projectName(issue)}</span>
          {/if}
          <span class="note-inline">
            {#if action === 'in-project'}
              <Label label={tracker.string.AddItemInProject} />
            {:else if action === 'restore'}
              <Label label={tracker.string.AddItemArchived} />
            {:else if action === 'move'}
              <Label label={tracker.string.AddItemMoveHere} />
            {:else}
              <Label label={tracker.string.AddItemOtherType} />
            {/if}
          </span>
        </div>
      {/each}
    </div>
  {/if}
  <div class="hint"><Label label={tracker.string.AddItemMoveHint} /></div>
</div>

<style lang="scss">
  .add-item-search {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    background: var(--theme-popup-color, var(--theme-bg-color));
    overflow: hidden;

    &.below {
      margin-top: 0.25rem;
    }
  }
  .list {
    display: flex;
    flex-direction: column;
    max-height: 12rem;
    overflow-y: auto;
  }
  .result {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    padding: 0.25rem 0.625rem;
    font-size: 0.8125rem;
    cursor: pointer;

    &.selected {
      background: var(--theme-popup-hover, var(--theme-button-hovered));
    }
    &.dimmed {
      cursor: default;
      opacity: 0.6;
    }
  }
  .identifier {
    flex-shrink: 0;
    color: var(--theme-halfcontent-color);
  }
  .title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--theme-caption-color);
  }
  .project {
    flex-shrink: 0;
    padding: 0 0.375rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.75rem;
    font-size: 0.6875rem;
    color: var(--theme-halfcontent-color);
  }
  .note-inline {
    flex-shrink: 0;
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }
  .note {
    display: flex;
    justify-content: center;
    padding: 0.5rem;
    font-size: 0.8125rem;
    color: var(--theme-dark-color);
  }
  .hint {
    padding: 0.25rem 0.625rem;
    font-size: 0.6875rem;
    color: var(--theme-dark-color);
    border-top: 1px solid var(--theme-divider-color);
  }
</style>
