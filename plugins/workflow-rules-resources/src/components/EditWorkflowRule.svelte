<!-- SPDX-License-Identifier: EPL-2.0 -->
<!-- Copyright © 2026 Platform Collective Contributors -->
<script lang="ts">
  import { type Ref } from '@hcengineering/core'
  import { Card, getClient } from '@hcengineering/presentation'
  import task, { type ProjectType, type TaskType } from '@hcengineering/task'
  import tracker, { type IssueStatus, type Project } from '@hcengineering/tracker'
  import { Button, DropdownLabels, Label, Toggle, type DropdownTextItem } from '@hcengineering/ui'
  import { type WorkflowRule, type WorkflowRuleAllowedLoop, type WorkflowRuleLinkKind } from '@hcengineering/workflow-rules'
  import { createEventDispatcher } from 'svelte'

  import workflowRules from '../plugin'

  export let currentSpace: Ref<Project>
  // The primary (forward) rule the user clicked Advanced on. Required: the
  // Advanced editor only edits one rule at a time; retargeting or
  // bidirectional changes go through the pairing wizard. `partner` is the
  // reverse rule if any, carried through so a future delete-pair action
  // from here can keep the two sides in step.
  export let rule: WorkflowRule
  export let partner: WorkflowRule | undefined = undefined

  const client = getClient()
  const dispatch = createEventDispatcher()

  // Defensive: if a caller somehow passes a rule from a different project,
  // refuse to save. Panel code only opens this editor on the primary side.
  const primaryMismatch = rule.space !== currentSpace

  // The Advanced editor does not retarget or change linkKind - those are
  // destructive to the partner rule. The user does that by deleting +
  // re-creating via the pairing wizard. We only expose the editable
  // internals of ONE rule here.
  let forwardMap: Record<string, string> = { ...(rule.forwardMap ?? {}) }
  let allowedLoops: WorkflowRuleAllowedLoop[] = [...(rule.allowedLoops ?? [])]
  let enabled: boolean = rule.enabled

  let sourceStatuses: Array<{ id: Ref<IssueStatus>, name: string }> = []
  let targetStatuses: Array<{ id: Ref<IssueStatus>, name: string }> = []
  let loadingStatuses = false
  let loadToken = 0

  const linkKindDisplay = (): WorkflowRuleLinkKind => rule.linkKind

  async function statusesOf(
    projId: Ref<Project> | undefined,
    token: number
  ): Promise<Array<{ id: Ref<IssueStatus>, name: string }>> {
    if (projId === undefined) return []
    const proj = await client.findOne(tracker.class.Project, { _id: projId })
    if (proj === undefined || token !== loadToken) return []
    const ptype = await client.findOne<ProjectType>(task.class.ProjectType, { _id: proj.type })
    if (ptype === undefined || token !== loadToken) return []
    const ttId = ptype.tasks?.[0]
    if (ttId === undefined) return []
    const tt = await client.findOne<TaskType>(task.class.TaskType, { _id: ttId })
    if (tt === undefined || token !== loadToken) return []
    const out: Array<{ id: Ref<IssueStatus>, name: string }> = []
    const statusIds = (tt.statuses ?? []) as Array<Ref<IssueStatus>>
    for (const sid of statusIds) {
      const s = await client.findOne(tracker.class.IssueStatus, { _id: sid })
      if (token !== loadToken) return []
      if (s !== undefined) out.push({ id: sid, name: s.name })
    }
    return out
  }

  async function loadAll(): Promise<void> {
    loadToken++
    const token = loadToken
    loadingStatuses = true
    const src = await statusesOf(currentSpace, token)
    const dst = await statusesOf(rule.linkedProject, token)
    if (token !== loadToken) return
    sourceStatuses = src
    targetStatuses = dst
    loadingStatuses = false
  }

  void loadAll()

  $: targetItems = [
    { id: '', label: '' } as DropdownTextItem,
    ...targetStatuses.map((s) => ({ id: s.id, label: s.name }) as DropdownTextItem)
  ]
  $: statusItems = targetStatuses.map((s) => ({ id: s.id, label: s.name }) as DropdownTextItem)
  $: targetSet = new Set(targetStatuses.map((s) => s.id))

  function setForward(sourceId: string, detail: unknown): void {
    const targetId = (detail ?? '') as string
    if (targetId === '') {
      const next = { ...forwardMap }
      delete next[sourceId]
      forwardMap = next
    } else {
      forwardMap = { ...forwardMap, [sourceId]: targetId }
    }
  }

  function addLoop(): void {
    if (targetStatuses.length < 2) return
    allowedLoops = [...allowedLoops, { from: targetStatuses[1].id, to: targetStatuses[0].id }]
  }

  function removeLoop(i: number): void {
    allowedLoops = allowedLoops.filter((_, idx) => idx !== i)
  }

  function setLoopFrom(i: number, detail: unknown): void {
    const from = detail as Ref<IssueStatus>
    allowedLoops = allowedLoops.map((l, idx) => (idx === i ? { ...l, from } : l))
  }

  function setLoopTo(i: number, detail: unknown): void {
    const to = detail as Ref<IssueStatus>
    allowedLoops = allowedLoops.map((l, idx) => (idx === i ? { ...l, to } : l))
  }

  // Reject loops whose endpoints are equal (identity move) or that reference
  // a status that is not in the current target TaskType - the server guard
  // would ignore those anyway, but keeping them in the stored doc leaks
  // stale references.
  $: loopsValid = allowedLoops.every(
    (l) => l.from !== l.to && targetSet.has(l.from) && targetSet.has(l.to)
  )

  $: canSave = !primaryMismatch && Object.keys(forwardMap).length > 0 && !loadingStatuses && loopsValid

  async function save(): Promise<void> {
    if (!canSave) return
    await client.updateDoc(workflowRules.class.WorkflowRule, rule.space, rule._id, {
      forwardMap,
      allowedLoops,
      enabled
    })
    dispatch('close')
  }
</script>

<Card
  label={workflowRules.string.EditRule}
  canSave={canSave}
  okLabel={workflowRules.string.Save}
  okAction={save}
  on:close
  width={'large'}
>
  <div class="body">
    <section class="row">
      <div class="field">
        <div class="field-label"><Label label={workflowRules.string.LinkKind} /></div>
        <div class="field-value">
          <Label
            label={linkKindDisplay() === 'subIssue'
              ? workflowRules.string.SubIssue
              : workflowRules.string.ParentIssue}
          />
        </div>
      </div>
      <div class="field toggle">
        <div class="field-label"><Label label={workflowRules.string.Enabled} /></div>
        <Toggle bind:on={enabled} />
      </div>
    </section>

    <section class="section">
      <h4><Label label={workflowRules.string.StatusMatrix} /></h4>
      {#if primaryMismatch}
        <p class="hint"><Label label={workflowRules.string.EditFromPrimary} /></p>
      {:else if loadingStatuses || sourceStatuses.length === 0 || targetStatuses.length === 0}
        <p class="hint"><Label label={workflowRules.string.LoadingStatuses} /></p>
      {:else}
        <table class="matrix">
          <thead>
            <tr>
              <th><Label label={workflowRules.string.LinkedProject} /></th>
              <th><Label label={workflowRules.string.StatusMatrix} /></th>
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
                    placeholder={workflowRules.string.NoMirror}
                    autoSelect={false}
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
          disabled={targetStatuses.length < 2}
          on:click={addLoop}
        />
      </div>
      <p class="hint"><Label label={workflowRules.string.AllowedLoopsHint} /></p>
      {#if allowedLoops.length === 0}
        <p class="hint"><Label label={workflowRules.string.NoLoopsYet} /></p>
      {:else}
        <div class="loops">
          {#each allowedLoops as loop, i (i)}
            {@const invalid = loop.from === loop.to || !targetSet.has(loop.from) || !targetSet.has(loop.to)}
            <div class="loop-row" class:invalid>
              <DropdownLabels
                items={statusItems}
                selected={loop.from}
                autoSelect={false}
                on:selected={(e) => setLoopFrom(i, e.detail)}
              />
              <span class="arrow">→</span>
              <DropdownLabels
                items={statusItems}
                selected={loop.to}
                autoSelect={false}
                on:selected={(e) => setLoopTo(i, e.detail)}
              />
              <Button
                label={workflowRules.string.Remove}
                kind="ghost"
                size="small"
                on:click={() => removeLoop(i)}
              />
              {#if invalid}
                <div class="loop-error">
                  <Label
                    label={loop.from === loop.to
                      ? workflowRules.string.LoopFromToSame
                      : workflowRules.string.LoopInvalid}
                  />
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </div>
</Card>

<style lang="scss">
  .body { display: flex; flex-direction: column; gap: 1.5rem; min-width: 36rem; }
  .row { display: grid; grid-template-columns: 1fr auto; gap: 1rem; align-items: end; }
  .field { display: flex; flex-direction: column; gap: 0.25rem; }
  .field.toggle { justify-items: start; }
  .field-label { font-size: 0.8125rem; color: var(--theme-dark-color); font-weight: 500; }
  .field-value { color: var(--theme-caption-color); font-size: 0.9375rem; }
  .section { display: flex; flex-direction: column; gap: 0.5rem; }
  .section-head { display: flex; justify-content: space-between; align-items: center; }
  h4 { margin: 0; font-size: 0.9375rem; color: var(--theme-caption-color); }
  .hint { margin: 0; font-size: 0.8125rem; color: var(--theme-dark-color); }
  .matrix { width: 100%; border-collapse: collapse; }
  .matrix th, .matrix td { padding: 0.5rem; border-bottom: 1px solid var(--theme-divider-color); text-align: left; }
  .matrix th {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 500;
  }
  .matrix tr:last-child td { border-bottom: none; }
  .status-cell { display: flex; align-items: center; gap: 0.5rem; }
  .status-dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--theme-progress-color); }
  .loops { display: flex; flex-direction: column; gap: 0.5rem; }
  .loop-row {
    display: grid;
    grid-template-columns: 1fr auto 1fr auto;
    gap: 0.5rem;
    align-items: center;
  }
  .loop-row.invalid { outline: 1px solid var(--theme-warning-color); border-radius: 0.25rem; padding: 0.125rem; }
  .loop-error { grid-column: 1 / -1; font-size: 0.75rem; color: var(--theme-warning-color); }
  .arrow { color: var(--theme-dark-color); font-size: 0.8125rem; }
</style>
