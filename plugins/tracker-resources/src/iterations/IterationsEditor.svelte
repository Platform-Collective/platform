<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { translate, type IntlString } from '@hcengineering/platform'
  import { getClient, MessageBox } from '@hcengineering/presentation'
  import {
    groupIterationsByState,
    type Iteration,
    type IterationChange,
    type IterationPlanError,
    type ProjectField
  } from '@hcengineering/tracker'
  import { Button, IconAdd, IconCollapseArrow, Label, showPopup, themeStore } from '@hcengineering/ui'

  import tracker from '../plugin'
  import { addIteration, changeIteration, removeIteration } from './actions'
  import IterationRow from './IterationRow.svelte'
  import { iterationsOfField, iterationsStore } from './iterationsStore'

  // Settings of an Iteration field: the title, start and duration of every iteration, breaks between them.
  // Every change is saved at once; changing a duration or a start moves the later iterations.
  export let field: ProjectField

  const client = getClient()

  const errorLabels: Record<IterationPlanError, IntlString> = {
    overlap: tracker.string.IterationErrorOverlap,
    invalidDuration: tracker.string.IterationErrorInvalidDuration,
    emptyLabel: tracker.string.IterationErrorEmptyLabel,
    unknown: tracker.string.IterationErrorInvalidDuration
  }

  $: store = iterationsStore(field.space)
  $: iterations = iterationsOfField($store, field)
  $: grouped = groupIterationsByState(iterations, Date.now())
  $: upcoming = [...(grouped.current !== undefined ? [grouped.current] : []), ...grouped.planned]
  // The newest completed iteration first
  $: completed = [...grouped.completed].reverse()

  let error: IterationPlanError | undefined
  let showCompleted = false

  async function change (iteration: Iteration, patch: IterationChange): Promise<void> {
    error = await changeIteration(client, iterations, iteration._id, patch)
  }

  async function add (afterId: Iteration['_id'] | undefined, isBreak: boolean): Promise<void> {
    const label = isBreak ? await translate(tracker.string.IterationBreak, {}, $themeStore.language) : undefined
    error = await addIteration(client, field, iterations, { afterId, isBreak, label, now: Date.now() })
  }

  function remove (iteration: Iteration): void {
    if (iteration.isBreak === true) {
      void removeIteration(client, iteration)
      return
    }
    showPopup(MessageBox, {
      label: tracker.string.DeleteIteration,
      labelProps: { name: iteration.label },
      message: tracker.string.DeleteIterationConfirm,
      params: { name: iteration.label },
      action: async () => {
        await removeIteration(client, iteration)
      }
    })
  }
</script>

<div class="flex-col flex-gap-2">
  <div class="fs-bold"><Label label={tracker.string.UpcomingIterations} /></div>
  {#if upcoming.length === 0}
    <div class="content-dark-color"><Label label={tracker.string.NoIterations} /></div>
  {/if}
  {#each upcoming as iteration (iteration._id)}
    <IterationRow
      {iteration}
      on:change={(e) => change(iteration, e.detail)}
      on:insertBreak={() => add(iteration._id, true)}
      on:remove={() => remove(iteration)}
    />
  {/each}
  <div class="flex-row-center">
    <Button icon={IconAdd} label={tracker.string.AddIteration} kind={'ghost'} on:click={() => add(undefined, false)} />
  </div>

  {#if completed.length > 0}
    <button class="completed-toggle fs-bold" on:click={() => (showCompleted = !showCompleted)}>
      <span class="chevron" class:open={showCompleted}><IconCollapseArrow size={'small'} /></span>
      <Label label={tracker.string.CompletedIterations} /> ({completed.length})
    </button>
    {#if showCompleted}
      {#each completed as iteration (iteration._id)}
        <IterationRow
          {iteration}
          datesLocked
          on:change={(e) => change(iteration, e.detail)}
          on:insertBreak={() => add(iteration._id, true)}
          on:remove={() => remove(iteration)}
        />
      {/each}
    {/if}
  {/if}

  {#if error !== undefined}
    <div class="error-color"><Label label={errorLabels[error]} /></div>
  {/if}
  <div class="content-dark-color fs-small"><Label label={tracker.string.IterationSavedImmediately} /></div>
</div>

<style lang="scss">
  .completed-toggle {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0;
    color: inherit;
    background: none;
    border: none;
    cursor: pointer;
  }
  .chevron {
    display: inline-flex;
    transform: rotate(-90deg);
    &.open {
      transform: none;
    }
  }
</style>
