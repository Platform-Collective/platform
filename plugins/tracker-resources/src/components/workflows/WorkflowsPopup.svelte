<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import contact, { getName, type Employee } from '@hcengineering/contact'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { translate, type IntlString } from '@hcengineering/platform'
  import task from '@hcengineering/task'
  import {
    buildWorkflowFilterSchema,
    isFieldWorkflowKind,
    isFilterWorkflowKind,
    MAX_WORKFLOW_ITEMS_PER_RUN,
    ProjectFieldType,
    resolveFieldTarget,
    toIterationRanges,
    validateWorkflow,
    WorkflowKind,
    type EffectiveWorkflow,
    type FieldWorkflowKind,
    type Project
  } from '@hcengineering/tracker'
  import { DropdownLabels, Label, Toggle, themeStore, type DropdownTextItem } from '@hcengineering/ui'
  import type { filterGrammar } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'

  import { sharedIterationsStore } from '../../iterations/iterationsStore'
  import tracker from '../../plugin'
  import ProjectSettingsCard from '../projects/ProjectSettingsCard.svelte'
  import { sharedProjectFieldsStore } from '../../projectFields/projectFieldsStore'
  import { compileWorkflowPreview } from '../../workflows/preview'
  import { saveWorkflow, type WorkflowPatch } from '../../workflows/save'
  import { workflowsStore } from '../../workflows/store'
  import WorkflowFilterEditor from './WorkflowFilterEditor.svelte'

  // The built-in workflows of a project (GitHub "Workflows"): a toggle for each, the field the item workflows write,
  // the filter of the filter workflows
  export let project: Project
  // Shown in a section of the project settings instead of a popup
  export let embedded: boolean = false

  const client = getClient()
  const dispatch = createEventDispatcher()

  const titles: Record<WorkflowKind, { title: IntlString, descr: IntlString }> = {
    [WorkflowKind.SetStatusDoneOnClose]: {
      title: tracker.string.WorkflowSetStatusDoneOnClose,
      descr: tracker.string.WorkflowSetStatusDoneOnCloseDescr
    },
    [WorkflowKind.ItemReopened]: {
      title: tracker.string.WorkflowItemReopened,
      descr: tracker.string.WorkflowItemReopenedDescr
    },
    [WorkflowKind.ItemAdded]: { title: tracker.string.WorkflowItemAdded, descr: tracker.string.WorkflowItemAddedDescr },
    [WorkflowKind.AutoArchive]: {
      title: tracker.string.WorkflowAutoArchive,
      descr: tracker.string.WorkflowAutoArchiveDescr
    },
    [WorkflowKind.AutoAddFromQuery]: {
      title: tracker.string.WorkflowAutoAddFromQuery,
      descr: tracker.string.WorkflowAutoAddFromQueryDescr
    }
  }

  $: workflows = workflowsStore(project._id)
  $: registry = sharedProjectFieldsStore(project._id)
  $: iterationsStore = sharedIterationsStore(project._id)
  $: fields = $registry.fields
  $: selectFields = fields.filter((f) => f.type === ProjectFieldType.SingleSelect)

  // ---- what the names of a filter resolve against (the same as on the server) ----
  const statusQuery = createQuery()
  const componentQuery = createQuery()
  const milestoneQuery = createQuery()
  const employeeQuery = createQuery()
  let statuses: Array<{ id: string, name: string, closed: boolean }> = []
  let components: Array<{ id: string, name: string }> = []
  let milestones: Array<{ id: string, name: string }> = []
  let assignees: Array<{ id: string, name: string }> = []

  statusQuery.query(tracker.class.IssueStatus, {}, (res) => {
    statuses = res.map((s) => ({
      id: s._id,
      name: s.name,
      closed: s.category === task.statusCategory.Won || s.category === task.statusCategory.Lost
    }))
  })
  $: componentQuery.query(tracker.class.Component, { space: project._id }, (res) => {
    components = res.map((c) => ({ id: c._id, name: c.label }))
  })
  $: milestoneQuery.query(tracker.class.Milestone, { space: project._id }, (res) => {
    milestones = res.map((m) => ({ id: m._id, name: m.label }))
  })
  employeeQuery.query(contact.mixin.Employee, { active: true }, (res: Employee[]) => {
    const hierarchy = client.getHierarchy()
    assignees = res.map((e) => ({ id: e._id, name: getName(hierarchy, e) }))
  })

  $: schema = buildWorkflowFilterSchema({
    statuses: statuses.map((s) => ({ id: s.id, name: s.name })),
    assignees,
    components,
    milestones,
    customFields: fields,
    iterations: $iterationsStore,
    noParentId: tracker.ids.NoParent as string
  }) as filterGrammar.FieldSpec[]
  $: closedStatuses = new Set(statuses.filter((s) => s.closed).map((s) => s.id))
  $: ctx = {
    now: Date.now(),
    closedStatuses,
    noParentId: tracker.ids.NoParent as string,
    iterations: (key: string) => {
      const field = fields.find((f) => f.key === key)
      return toIterationRanges($iterationsStore.filter((it) => it.field === field?._id))
    }
  } satisfies filterGrammar.FilterContext

  // ---- editing ----
  let message: { kind: WorkflowKind, text: IntlString } | undefined

  async function save (workflow: EffectiveWorkflow, patch: WorkflowPatch): Promise<void> {
    try {
      await saveWorkflow(client, project._id, workflow, patch)
    } catch (err: any) {
      Analytics.handleError(err)
    }
  }

  function toggle (workflow: EffectiveWorkflow, enabled: boolean): void {
    message = undefined
    if (enabled) {
      // A workflow that can not do anything useful is not switched on: say why
      const error = validateWorkflow(workflow, fields)
      if (error === 'filterRequired' || error === 'filterTooLong') {
        message = { kind: workflow.kind, text: tracker.string.WorkflowFilterRequired }
        return
      }
      if (isFilterWorkflowKind(workflow.kind) && compileWorkflowPreview(workflow.kind, workflow.filter, schema, ctx).ok === false) {
        message = { kind: workflow.kind, text: tracker.string.WorkflowFilterInvalid }
        return
      }
    }
    void save(workflow, { enabled })
  }

  function applyFilter (workflow: EffectiveWorkflow, filter: string): void {
    message = undefined
    void save(workflow, { filter })
  }

  // ---- the field of an item workflow ----
  let automaticLabel = ''
  $: void translate(tracker.string.WorkflowTargetAutomatic, {}, $themeStore.language).then((text) => {
    automaticLabel = text
  })
  const AUTOMATIC = ''

  function fieldItems (labelOfAutomatic: string): DropdownTextItem[] {
    return [{ id: AUTOMATIC, label: labelOfAutomatic }, ...selectFields.map((f) => ({ id: f.key, label: f.label }))]
  }

  function optionItems (key: string | undefined): DropdownTextItem[] {
    return (selectFields.find((f) => f.key === key)?.options ?? []).map((o) => ({ id: o.value, label: o.label }))
  }

  function chooseField (workflow: EffectiveWorkflow, key: string | undefined): void {
    if (key === undefined || key === AUTOMATIC) {
      void save(workflow, { config: {} })
      return
    }
    const first = selectFields.find((f) => f.key === key)?.options?.[0]
    if (first === undefined) return
    void save(workflow, { config: { target: { field: key, option: first.value } } })
  }

  function chooseOption (workflow: EffectiveWorkflow, option: string | undefined): void {
    const field = workflow.config.target?.field
    if (field === undefined || option === undefined) return
    void save(workflow, { config: { target: { field, option } } })
  }

  function resolved (workflow: EffectiveWorkflow): { field: string, value: string } | undefined {
    if (!isFieldWorkflowKind(workflow.kind)) return undefined
    const target = resolveFieldTarget(workflow.kind as FieldWorkflowKind, workflow.config, fields)
    return target === undefined ? undefined : { field: target.field.label, value: target.option.label }
  }
</script>

<ProjectSettingsCard
  {embedded}
  label={tracker.string.Workflows}
  hideFooter
  width={'large'}
  onCancel={() => dispatch('close')}
  on:close
  on:changeContent
>
  <div class="content-dark-color"><Label label={tracker.string.WorkflowsHint} /></div>
  {#each $workflows as workflow (workflow.kind)}
    <div class="workflow" data-id={`workflow-${workflow.kind}`}>
      <div class="flex-row-center flex-gap-2">
        <div class="flex-grow fs-bold"><Label label={titles[workflow.kind].title} /></div>
        <span class="content-dark-color"><Label label={tracker.string.WorkflowEnabled} /></span>
        <Toggle
          id={`workflow-toggle-${workflow.kind}`}
          on={workflow.enabled}
          on:change={(e) => {
            toggle(workflow, e.detail)
          }}
        />
      </div>
      <div class="content-dark-color"><Label label={titles[workflow.kind].descr} /></div>
      {#if message?.kind === workflow.kind}
        <div class="error-color"><Label label={message.text} /></div>
      {/if}

      {#if isFieldWorkflowKind(workflow.kind)}
        {@const target = resolved(workflow)}
        <div class="flex-row-center flex-gap-2">
          <Label label={tracker.string.WorkflowTargetField} />
          <DropdownLabels
            items={fieldItems(automaticLabel)}
            selected={workflow.config.target?.field ?? AUTOMATIC}
            kind={'regular'}
            size={'medium'}
            enableSearch={false}
            on:selected={(e) => {
              chooseField(workflow, e.detail)
            }}
          />
          {#if workflow.config.target !== undefined}
            <Label label={tracker.string.WorkflowTargetValue} />
            <DropdownLabels
              items={optionItems(workflow.config.target.field)}
              selected={workflow.config.target.option}
              kind={'regular'}
              size={'medium'}
              enableSearch={false}
              on:selected={(e) => {
                chooseOption(workflow, e.detail)
              }}
            />
          {/if}
        </div>
        <div class="content-dark-color" data-id="workflow-target">
          {#if target !== undefined}
            <Label label={tracker.string.WorkflowTargetResolved} params={{ field: target.field, value: target.value }} />
          {:else}
            <Label label={tracker.string.WorkflowTargetNone} />
          {/if}
        </div>
      {:else if isFilterWorkflowKind(workflow.kind)}
        <WorkflowFilterEditor
          {project}
          kind={workflow.kind}
          filter={workflow.filter}
          {schema}
          {ctx}
          on:apply={(e) => {
            applyFilter(workflow, e.detail)
          }}
        />
      {/if}
    </div>
  {/each}
  <div class="content-dark-color">
    <Label label={tracker.string.WorkflowRunNote} params={{ limit: MAX_WORKFLOW_ITEMS_PER_RUN }} />
  </div>
</ProjectSettingsCard>

<style lang="scss">
  .workflow {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
  }
</style>
