<!-- SPDX-License-Identifier: EPL-2.0 -->
<!-- Copyright © 2026 Platform Collective Contributors -->
<script lang="ts">
  import { generateId, type Ref } from '@hcengineering/core'
  import { Card, getClient } from '@hcengineering/presentation'
  import task, { type ProjectType, type TaskType } from '@hcengineering/task'
  import tracker, { type IssueStatus, type Project } from '@hcengineering/tracker'
  import { Button, DropdownLabels, Label, Toggle, type DropdownTextItem } from '@hcengineering/ui'
  import { type WorkflowRule, type WorkflowRuleAllowedLoop, type WorkflowRuleLinkKind } from '@hcengineering/workflow-rules'
  import { createEventDispatcher } from 'svelte'

  import workflowRules from '../plugin'

  export let currentSpace: Ref<Project>
  export let rule: WorkflowRule | undefined = undefined

  const client = getClient()
  const dispatch = createEventDispatcher()

  let linkedProject: Ref<Project> | undefined = rule?.linkedProject
  let linkKind: WorkflowRuleLinkKind = rule?.linkKind ?? 'subIssue'
  let forwardMap: Record<string, string> = { ...(rule?.forwardMap ?? {}) }
  let allowedLoops: WorkflowRuleAllowedLoop[] = [...(rule?.allowedLoops ?? [])]
  let enabled: boolean = rule?.enabled ?? true

  let projects: Project[] = []
  let sourceStatuses: Array<{ id: Ref<IssueStatus>, name: string }> = []
  let targetStatuses: Array<{ id: Ref<IssueStatus>, name: string }> = []

  async function loadProjects (): Promise<void> {
    const all = await client.findAll(tracker.class.Project, {})
    projects = all.filter((p) => p._id !== currentSpace)
  }
  loadProjects()

  async function statusesOf (projId: Ref<Project> | undefined): Promise<Array<{ id: Ref<IssueStatus>, name: string }>> {
    if (projId === undefined) return []
    const proj = await client.findOne(tracker.class.Project, { _id: projId })
    if (proj === undefined) return []
    const ptype = await client.findOne<ProjectType>(task.class.ProjectType, { _id: proj.type })
    if (ptype === undefined) return []
    const ttId = ptype.tasks?.[0]
    if (ttId === undefined) return []
    const tt = await client.findOne<TaskType>(task.class.TaskType, { _id: ttId })
    if (tt === undefined) return []
    const out: Array<{ id: Ref<IssueStatus>, name: string }> = []
    const statusIds = (tt.statuses ?? []) as Array<Ref<IssueStatus>>
    for (const sid of statusIds) {
      const s = await client.findOne(tracker.class.IssueStatus, { _id: sid })
      if (s !== undefined) out.push({ id: sid, name: s.name })
    }
    return out
  }

  $: void statusesOf(currentSpace).then((v) => { sourceStatuses = v })
  $: void statusesOf(linkedProject).then((v) => { targetStatuses = v })

  $: projectItems = projects.map((p) => ({ id: p._id, label: p.identifier + '  ' + p.name } as DropdownTextItem))
  const linkKindItems: DropdownTextItem[] = [
    { id: 'subIssue', label: 'Sub-issue' },
    { id: 'parentIssue', label: 'Parent issue' }
  ]
  $: targetItems = [
    { id: '', label: '(no mirror)' } as DropdownTextItem,
    ...targetStatuses.map((s) => ({ id: s.id, label: s.name } as DropdownTextItem))
  ]
  $: statusItems = targetStatuses.map((s) => ({ id: s.id, label: s.name } as DropdownTextItem))

  function onPickProject (detail: unknown): void {
    linkedProject = detail as Ref<Project>
    forwardMap = {}
    allowedLoops = []
  }
  function onPickLinkKind (detail: unknown): void {
    linkKind = detail as WorkflowRuleLinkKind
  }
  function setForward (sourceId: string, detail: unknown): void {
    const targetId = (detail ?? '') as string
    if (targetId === '') {
      const next = { ...forwardMap }
      delete next[sourceId]
      forwardMap = next
    } else {
      forwardMap = { ...forwardMap, [sourceId]: targetId }
    }
  }

  function addLoop (): void {
    if (targetStatuses.length === 0) return
    allowedLoops = [...allowedLoops, { from: targetStatuses[0].id, to: targetStatuses[0].id }]
  }
  function removeLoop (i: number): void {
    allowedLoops = allowedLoops.filter((_, idx) => idx !== i)
  }
  function setLoopFrom (i: number, detail: unknown): void {
    const from = detail as Ref<IssueStatus>
    allowedLoops = allowedLoops.map((l, idx) => idx === i ? { ...l, from } : l)
  }
  function setLoopTo (i: number, detail: unknown): void {
    const to = detail as Ref<IssueStatus>
    allowedLoops = allowedLoops.map((l, idx) => idx === i ? { ...l, to } : l)
  }

  $: canSave = linkedProject !== undefined && Object.keys(forwardMap).length > 0
  $: dialogLabel = rule !== undefined ? workflowRules.string.EditRule : workflowRules.string.AddRule
  $: mappingCount = Object.keys(forwardMap).length
  $: loopCount = allowedLoops.length

  async function save (): Promise<void> {
    if (!canSave || linkedProject === undefined) return
    const data = {
      linkedProject,
      linkKind,
      forwardMap,
      allowedLoops,
      enabled
    }
    if (rule !== undefined) {
      await client.updateDoc(workflowRules.class.WorkflowRule, rule.space, rule._id, data)
    } else {
      const newId = generateId()
      await client.createDoc(workflowRules.class.WorkflowRule, currentSpace, data as any, newId as any)
    }
    dispatch('close')
  }
</script>

<Card
  label={dialogLabel}
  canSave={canSave}
  okLabel={workflowRules.string.Save}
  okAction={save}
  on:close
  width={'large'}
>
  <div class="body">
    <section class="row">
      <div class="field">
        <div class="field-label"><Label label={workflowRules.string.LinkedProject} /></div>
        <DropdownLabels
          items={projectItems}
          selected={linkedProject}
          placeholder={workflowRules.string.SelectProject}
          on:selected={(e) => onPickProject(e.detail)}
        />
      </div>
      <div class="field">
        <div class="field-label"><Label label={workflowRules.string.LinkKind} /></div>
        <DropdownLabels
          items={linkKindItems}
          selected={linkKind}
          on:selected={(e) => onPickLinkKind(e.detail)}
        />
      </div>
      <div class="field toggle">
        <div class="field-label"><Label label={workflowRules.string.Enabled} /></div>
        <Toggle bind:on={enabled} />
      </div>
    </section>

    <section class="section">
      <h4><Label label={workflowRules.string.StatusMatrix} /></h4>
      {#if linkedProject === undefined}
        <p class="hint"><Label label={workflowRules.string.PickTargetFirst} /></p>
      {:else if sourceStatuses.length === 0 || targetStatuses.length === 0}
        <p class="hint">Loading statuses...</p>
      {:else}
        <table class="matrix">
          <thead>
            <tr>
              <th>Source (this project)</th>
              <th>Target (linked project)</th>
            </tr>
          </thead>
          <tbody>
            {#each sourceStatuses as src (src.id)}
              <tr>
                <td class="status-cell"><span class="status-dot" /> {src.name}</td>
                <td>
                  <DropdownLabels
                    items={targetItems}
                    selected={forwardMap[src.id] ?? ''}
                    on:selected={(e) => setForward(src.id, e.detail)}
                  />
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>

    <section class="section">
      <div class="section-head">
        <h4><Label label={workflowRules.string.AllowedLoops} /></h4>
        <Button
          label={workflowRules.string.AddLoop}
          kind="ghost"
          disabled={targetStatuses.length === 0}
          on:click={addLoop}
        />
      </div>
      <p class="hint"><Label label={workflowRules.string.AllowedLoopsHint} /></p>
      {#if allowedLoops.length === 0}
        <p class="hint"><Label label={workflowRules.string.NoLoopsYet} /></p>
      {:else}
        <div class="loops">
          {#each allowedLoops as loop, i (i)}
            <div class="loop-row">
              <DropdownLabels
                items={statusItems}
                selected={loop.from}
                on:selected={(e) => setLoopFrom(i, e.detail)}
              />
              <span class="arrow">to</span>
              <DropdownLabels
                items={statusItems}
                selected={loop.to}
                on:selected={(e) => setLoopTo(i, e.detail)}
              />
              <Button label={workflowRules.string.Remove} kind="ghost" size="small" on:click={() => removeLoop(i)} />
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <div class="counts">
      {mappingCount} status mappings, {loopCount} loops
    </div>
  </div>
</Card>

<style lang="scss">
  .body { display: flex; flex-direction: column; gap: 1.5rem; min-width: 36rem; }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 1rem;
    align-items: end;
  }
  .field { display: flex; flex-direction: column; gap: 0.25rem; }
  .field.toggle { justify-items: start; }
  .field-label {
    font-size: 0.8125rem;
    color: var(--theme-dark-color);
    font-weight: 500;
  }
  .section { display: flex; flex-direction: column; gap: 0.5rem; }
  .section-head { display: flex; justify-content: space-between; align-items: center; }
  h4 { margin: 0; font-size: 0.9375rem; color: var(--theme-caption-color); }
  .hint { margin: 0; font-size: 0.8125rem; color: var(--theme-dark-color); }
  .counts { font-size: 0.8125rem; color: var(--theme-dark-color); }
  .matrix {
    width: 100%;
    border-collapse: collapse;
  }
  .matrix th, .matrix td {
    padding: 0.5rem;
    border-bottom: 1px solid var(--theme-divider-color);
    text-align: left;
  }
  .matrix th {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 500;
  }
  .matrix tr:last-child td { border-bottom: none; }
  .status-cell { display: flex; align-items: center; gap: 0.5rem; }
  .status-dot {
    width: 0.5rem; height: 0.5rem; border-radius: 50%;
    background: var(--theme-progress-color);
  }
  .loops { display: flex; flex-direction: column; gap: 0.5rem; }
  .loop-row {
    display: grid;
    grid-template-columns: 1fr auto 1fr auto;
    gap: 0.5rem;
    align-items: center;
  }
  .arrow { color: var(--theme-dark-color); font-size: 0.8125rem; }
</style>
