<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import { SortingOrder } from '@hcengineering/core'
  import { createQuery, getClient, MessageBox } from '@hcengineering/presentation'
  import { archivedQuery, type Issue, type Project } from '@hcengineering/tracker'
  import { Button, Label, showPopup, themeStore } from '@hcengineering/ui'
  import { deleteObjects } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'

  import { setArchived } from '../../archive/apply'
  import tracker from '../../plugin'
  import ProjectSettingsCard from '../projects/ProjectSettingsCard.svelte'

  // The archived items of a project (GitHub "Archived items"): they can be restored or deleted for good
  export let project: Project
  // Shown in a section of the project settings instead of a popup
  export let embedded: boolean = false

  // Rows listed at once; the rest is reported, not hidden
  const LIMIT = 200

  const client = getClient()
  const dispatch = createEventDispatcher()
  const query = createQuery()

  let items: Issue[] = []
  let total = 0
  let busy = false

  $: query.query(
    tracker.class.Issue,
    { space: project._id, ...archivedQuery(true) } as any,
    (res) => {
      items = res
      total = res.total
    },
    { sort: { archivedAt: SortingOrder.Descending }, limit: LIMIT, total: true }
  )

  function formatDay (ts: number | null | undefined): string {
    return ts === undefined || ts === null ? '' : new Date(ts).toLocaleDateString($themeStore.language)
  }

  async function run (action: () => Promise<void>): Promise<void> {
    busy = true
    try {
      await action()
    } catch (err: any) {
      Analytics.handleError(err)
    } finally {
      busy = false
    }
  }

  async function restore (list: Issue[]): Promise<void> {
    await run(async () => {
      await setArchived(client, list, false)
    })
  }

  function remove (list: Issue[]): void {
    if (list.length === 0) return
    showPopup(MessageBox, {
      label: tracker.string.ArchivedDelete,
      message: tracker.string.ArchivedDeleteConfirm,
      params: { count: list.length },
      action: async () => {
        await run(async () => {
          await deleteObjects(client, list as any)
        })
      }
    })
  }
</script>

<ProjectSettingsCard
  {embedded}
  label={tracker.string.ArchivedItems}
  hideFooter
  width={'medium'}
  onCancel={() => dispatch('close')}
  on:close
  on:changeContent
>
  <div class="content-dark-color"><Label label={tracker.string.ArchivedItemsHint} /></div>
  {#if items.length === 0}
    <div class="flex-center p-4 content-dark-color" data-id="archived-empty">
      <Label label={tracker.string.ArchivedItemsEmpty} />
    </div>
  {/if}
  {#each items as issue (issue._id)}
    <div class="flex-row-center flex-gap-2" data-id="archived-row">
      <span class="content-dark-color">{issue.identifier}</span>
      <div class="flex-grow overflow-label" title={issue.title}>{issue.title}</div>
      <span class="content-dark-color" title={formatDay(issue.archivedAt)}>
        <Label label={tracker.string.ArchivedAt} /> {formatDay(issue.archivedAt)}
      </span>
      <Button
        label={tracker.string.RestoreItem}
        kind={'ghost'}
        size={'small'}
        disabled={busy}
        on:click={() => restore([issue])}
      />
      <Button
        label={tracker.string.ArchivedDelete}
        kind={'ghost'}
        size={'small'}
        disabled={busy}
        on:click={() => remove([issue])}
      />
    </div>
  {/each}
  {#if total > items.length}
    <div class="content-dark-color">
      <Label label={tracker.string.ArchivedItemsLimit} params={{ limit: items.length, total }} />
    </div>
  {/if}
  {#if items.length > 0}
    <div class="flex-row-center flex-gap-2">
      <Button label={tracker.string.ArchivedRestoreAll} kind={'regular'} disabled={busy} on:click={() => restore(items)} />
      <Button label={tracker.string.ArchivedDeleteAll} kind={'regular'} disabled={busy} on:click={() => remove(items)} />
    </div>
  {/if}
</ProjectSettingsCard>
