<!-- SPDX-License-Identifier: EPL-2.0 -->
<!-- Copyright © 2026 Platform Collective Contributors -->
<script lang="ts">
  import { generateId, type Ref } from '@hcengineering/core'
  import { Card, getClient } from '@hcengineering/presentation'
  import task, { type ProjectType, type TaskType } from '@hcengineering/task'
  import tracker, { type IssueStatus, type Project } from '@hcengineering/tracker'
  import { IssueStatusIcon } from '@hcengineering/tracker-resources'
  import { DropdownLabels, EditBox, Icon, Label, Toggle, IconArrowRight, type DropdownTextItem } from '@hcengineering/ui'
  import { type WorkflowRule } from '@hcengineering/workflow-rules'
  import { createEventDispatcher } from 'svelte'

  import workflowRules from '../plugin'

  export let currentSpace: Ref<Project>
  export let existingForward: WorkflowRule | undefined = undefined
  export let existingReverse: WorkflowRule | undefined = undefined

  const client = getClient()
  const dispatch = createEventDispatcher()

  const TERMINAL = new Set([task.statusCategory.Won, task.statusCategory.Lost])

  type StatusEntry = { id: Ref<IssueStatus>, name: string, category: string | undefined, status: IssueStatus }

  let projects: Project[] = []
  let projectsById: Record<string, Project> = {}
  let linkedProject: Ref<Project> | undefined = existingForward?.linkedProject
  let name: string = existingForward?.name ?? ''
  let nameDirty: boolean = existingForward !== undefined && (existingForward.name ?? '').length > 0
  let bidirectional = !(existingForward !== undefined && existingReverse === undefined)

  let sourceStatuses: StatusEntry[] = []
  let targetStatuses: StatusEntry[] = []
  let forwardMap: Record<string, string> = {}
  let reverseMap: Record<string, string> = {}

  async function loadProjects (): Promise<void> {
    const all = await client.findAll(tracker.class.Project, {})
    projects = all.filter((p) => p._id !== currentSpace)
    const map: Record<string, Project> = {}
    for (const p of all) map[p._id] = p
    projectsById = map
  }
  loadProjects()

  function defaultNameFor (linkedId: Ref<Project> | undefined): string {
    if (linkedId === undefined) return ''
    const p = projectsById[linkedId]
    if (p === undefined) return ''
    return `Pairing with ${p.name}`
  }

  $: if (!nameDirty && linkedProject !== undefined) {
    const auto = defaultNameFor(linkedProject)
    if (auto.length > 0) name = auto
  }

  async function statusesOf (projId: Ref<Project> | undefined): Promise<StatusEntry[]> {
    if (projId === undefined) return []
    const proj = await client.findOne(tracker.class.Project, { _id: projId })
    if (proj === undefined) return []
    const ptype = await client.findOne<ProjectType>(task.class.ProjectType, { _id: proj.type })
    if (ptype === undefined) return []
    const ttId = ptype.tasks?.[0]
    if (ttId === undefined) return []
    const tt = await client.findOne<TaskType>(task.class.TaskType, { _id: ttId })
    if (tt === undefined) return []
    const out: StatusEntry[] = []
    const statusIds = (tt.statuses ?? []) as Array<Ref<IssueStatus>>
    for (const sid of statusIds) {
      const s = await client.findOne(tracker.class.IssueStatus, { _id: sid })
      if (s !== undefined) out.push({ id: sid, name: s.name, category: s.category, status: s })
    }
    return out
  }

  function autoMatch (src: StatusEntry, targets: StatusEntry[]): Ref<IssueStatus> | undefined {
    const sameName = targets.find((t) => t.name.toLowerCase() === src.name.toLowerCase())
    if (sameName !== undefined) return sameName.id
    const sameCategory = targets.filter((t) => t.category === src.category)
    if (sameCategory.length > 0) return sameCategory[0].id
    return undefined
  }

  function buildAutoMap (src: StatusEntry[], dst: StatusEntry[]): Record<string, string> {
    const out: Record<string, string> = {}
    for (const s of src) {
      const t = autoMatch(s, dst)
      if (t !== undefined) out[s.id] = t
    }
    return out
  }

  function buildAllowedLoops (dstStatuses: StatusEntry[]): Array<{ from: Ref<IssueStatus>, to: Ref<IssueStatus> }> {
    const nonTerminal = dstStatuses.filter((s) => s.category === undefined || !TERMINAL.has(s.category as any))
    const loops: Array<{ from: Ref<IssueStatus>, to: Ref<IssueStatus> }> = []
    for (let i = 0; i < nonTerminal.length; i++) {
      for (let j = 0; j < i; j++) {
        loops.push({ from: nonTerminal[i].id, to: nonTerminal[j].id })
      }
    }
    return loops
  }

  async function onLinkedChange (): Promise<void> {
    sourceStatuses = await statusesOf(currentSpace)
    targetStatuses = await statusesOf(linkedProject)
    const seedForward = existingForward?.forwardMap
    const seedReverse = existingReverse?.forwardMap
    if (seedForward !== undefined && Object.keys(seedForward).length > 0) {
      forwardMap = { ...seedForward } as Record<string, string>
    } else {
      forwardMap = buildAutoMap(sourceStatuses, targetStatuses)
    }
    if (seedReverse !== undefined && Object.keys(seedReverse).length > 0) {
      reverseMap = { ...seedReverse } as Record<string, string>
    } else {
      reverseMap = buildAutoMap(targetStatuses, sourceStatuses)
    }
  }

  $: if (linkedProject !== undefined) void onLinkedChange()

  $: projectItems = projects.map((p) => ({ id: p._id, label: p.identifier + '  ' + p.name } as DropdownTextItem))
  $: targetMapItems = [
    { id: '', label: 'No mirror' } as DropdownTextItem,
    ...targetStatuses.map((s) => ({ id: s.id, label: s.name } as DropdownTextItem))
  ]
  $: sourceMapItems = [
    { id: '', label: 'No mirror' } as DropdownTextItem,
    ...sourceStatuses.map((s) => ({ id: s.id, label: s.name } as DropdownTextItem))
  ]

  function onPickLinked (detail: unknown): void {
    linkedProject = detail as Ref<Project>
  }
  function setForward (sourceId: string, detail: unknown): void {
    const t = (detail ?? '') as string
    const next = { ...forwardMap }
    if (t === '') { delete next[sourceId] } else { next[sourceId] = t }
    forwardMap = next
  }
  function setReverse (sourceId: string, detail: unknown): void {
    const t = (detail ?? '') as string
    const next = { ...reverseMap }
    if (t === '') { delete next[sourceId] } else { next[sourceId] = t }
    reverseMap = next
  }

  function mappedTarget (sourceId: string, targets: StatusEntry[]): StatusEntry | undefined {
    const tid = forwardMap[sourceId]
    if (tid === undefined) return undefined
    return targets.find((t) => t.id === tid)
  }
  function mappedReverse (sourceId: string, sources: StatusEntry[]): StatusEntry | undefined {
    const tid = reverseMap[sourceId]
    if (tid === undefined) return undefined
    return sources.find((t) => t.id === tid)
  }

  function isTerminal (s: StatusEntry): boolean {
    return s.category !== undefined && TERMINAL.has(s.category as any)
  }

  $: canSave = linkedProject !== undefined && Object.keys(forwardMap).length > 0

  async function save (): Promise<void> {
    if (!canSave || linkedProject === undefined) return
    const forwardLoops = buildAllowedLoops(targetStatuses)
    const reverseLoops = buildAllowedLoops(sourceStatuses)

    const trimmedName = name.trim()
    const forwardData = {
      linkedProject,
      linkKind: 'subIssue',
      name: trimmedName.length > 0 ? trimmedName : undefined,
      forwardMap,
      allowedLoops: forwardLoops,
      enabled: true
    }
    if (existingForward !== undefined) {
      await client.updateDoc(workflowRules.class.WorkflowRule, existingForward.space, existingForward._id, forwardData)
    } else {
      await client.createDoc(workflowRules.class.WorkflowRule, currentSpace, forwardData as any, generateId() as any)
    }

    if (bidirectional) {
      const reverseData = {
        linkedProject: currentSpace,
        linkKind: 'parentIssue',
        name: trimmedName.length > 0 ? trimmedName : undefined,
        forwardMap: reverseMap,
        allowedLoops: reverseLoops,
        enabled: true
      }
      if (existingReverse !== undefined) {
        await client.updateDoc(workflowRules.class.WorkflowRule, existingReverse.space, existingReverse._id, reverseData)
      } else {
        await client.createDoc(workflowRules.class.WorkflowRule, linkedProject, reverseData as any, generateId() as any)
      }
    } else if (existingReverse !== undefined) {
      await client.removeDoc(workflowRules.class.WorkflowRule, existingReverse.space, existingReverse._id)
    }

    dispatch('close')
  }
</script>

<Card
  label={existingForward !== undefined ? workflowRules.string.EditPair : workflowRules.string.PairProjects}
  canSave={canSave}
  okLabel={workflowRules.string.Save}
  okAction={save}
  on:close
  width={'large'}
>
  <div class="wfr-body">
    <section class="wfr-top">
      <div class="wfr-field grow">
        <div class="wfr-field-label"><Label label={workflowRules.string.Name} /></div>
        <EditBox
          bind:value={name}
          placeholder={workflowRules.string.NamePlaceholder}
          kind={'editbox'}
          on:change={() => { nameDirty = true }}
        />
      </div>
      <div class="wfr-field grow">
        <div class="wfr-field-label"><Label label={workflowRules.string.PairedWith} /></div>
        <DropdownLabels
          items={projectItems}
          selected={linkedProject}
          placeholder={workflowRules.string.SelectProject}
          on:selected={(e) => onPickLinked(e.detail)}
        />
      </div>
      <div class="wfr-field compact">
        <div class="wfr-field-label"><Label label={workflowRules.string.SyncBothWays} /></div>
        <Toggle bind:on={bidirectional} />
      </div>
    </section>

    {#if linkedProject === undefined}
      <div class="wfr-placeholder">
        <div class="wfr-placeholder-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="6" cy="6" r="2.5" />
            <circle cx="18" cy="18" r="2.5" />
            <path d="M8 7 l9 10" opacity="0.5" stroke-dasharray="2 2" />
          </svg>
        </div>
        <div class="wfr-placeholder-title"><Label label={workflowRules.string.PickTargetFirst} /></div>
      </div>
    {:else if sourceStatuses.length === 0 || targetStatuses.length === 0}
      <div class="wfr-placeholder">
        <div class="wfr-placeholder-sub">Loading statuses...</div>
      </div>
    {:else}
      <section class="wfr-section">
        <div class="wfr-section-head">
          <div class="wfr-section-title">Status mapping</div>
          <div class="wfr-section-caption">Pre-matched by category. Adjust any row.</div>
        </div>
        <div class="wfr-map">
          {#each sourceStatuses as src (src.id)}
            {@const target = mappedTarget(src.id, targetStatuses)}
            <div class="wfr-map-row" class:terminal={isTerminal(src)}>
              <div class="wfr-slot src">
                <IssueStatusIcon value={src.status} size="small" />
                <span class="wfr-slot-label">{src.name}</span>
                {#if isTerminal(src)}<span class="wfr-slot-tag">final</span>{/if}
              </div>
              <div class="wfr-connector">
                <Icon icon={IconArrowRight} size="small" />
              </div>
              <div class="wfr-slot dst">
                <DropdownLabels
                  items={targetMapItems}
                  selected={forwardMap[src.id] ?? ''}
                  width={'100%'}
                  on:selected={(e) => setForward(src.id, e.detail)}
                />
                {#if target !== undefined}
                  <div class="wfr-slot-preview">
                    <IssueStatusIcon value={target.status} size="small" />
                    <span>{target.name}</span>
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </section>

      {#if bidirectional}
        <section class="wfr-section">
          <div class="wfr-section-head">
            <div class="wfr-section-title">Reverse mapping</div>
            <div class="wfr-section-caption">What happens when a status changes on the linked side.</div>
          </div>
          <div class="wfr-map">
            {#each targetStatuses as t (t.id)}
              {@const back = mappedReverse(t.id, sourceStatuses)}
              <div class="wfr-map-row" class:terminal={isTerminal(t)}>
                <div class="wfr-slot src">
                  <IssueStatusIcon value={t.status} size="small" />
                  <span class="wfr-slot-label">{t.name}</span>
                  {#if isTerminal(t)}<span class="wfr-slot-tag">final</span>{/if}
                </div>
                <div class="wfr-connector">
                  <Icon icon={IconArrowRight} size="small" />
                </div>
                <div class="wfr-slot dst">
                  <DropdownLabels
                    items={sourceMapItems}
                    selected={reverseMap[t.id] ?? ''}
                    width={'100%'}
                    on:selected={(e) => setReverse(t.id, e.detail)}
                  />
                  {#if back !== undefined}
                    <div class="wfr-slot-preview">
                      <IssueStatusIcon value={back.status} size="small" />
                      <span>{back.name}</span>
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <div class="wfr-footer-note">
        <Label label={workflowRules.string.AutoLoopsHint} />
      </div>
    {/if}
  </div>
</Card>

<style lang="scss">
  .wfr-body {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    width: 100%;
    padding: 0;
    box-sizing: border-box;
  }
  .wfr-top {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 1.25rem;
    align-items: end;
    padding: 1rem 1.25rem;
    border-radius: 0.625rem;
    background: var(--theme-list-row-color);
    border: 1px solid var(--theme-divider-color);
  }
  .wfr-field { display: flex; flex-direction: column; gap: 0.375rem; }
  .wfr-field.compact { align-items: flex-start; min-width: 7rem; }
  .wfr-field-label {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .wfr-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 3rem 1rem;
    border: 1px dashed var(--theme-divider-color);
    border-radius: 0.75rem;
    color: var(--theme-dark-color);
  }
  .wfr-placeholder-icon { color: var(--theme-dark-color); opacity: 0.6; }
  .wfr-placeholder-title { color: var(--theme-caption-color); font-weight: 500; }
  .wfr-placeholder-sub { font-size: 0.875rem; }
  .wfr-section { display: flex; flex-direction: column; gap: 0.75rem; }
  .wfr-section-head { display: flex; flex-direction: column; gap: 0.125rem; padding: 0 0.25rem; }
  .wfr-section-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--theme-caption-color);
    letter-spacing: -0.01em;
  }
  .wfr-section-caption {
    font-size: 0.8125rem;
    color: var(--theme-dark-color);
  }
  .wfr-map {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem;
    border-radius: 0.625rem;
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-divider-color);
  }
  .wfr-map-row {
    display: grid;
    grid-template-columns: 1fr 1.5rem minmax(0, 1fr);
    gap: 0.75rem;
    align-items: center;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    transition: background 180ms ease;
  }
  .wfr-map-row:hover { background: var(--theme-list-row-color); }
  .wfr-map-row.terminal { opacity: 0.72; }
  .wfr-slot { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
  .wfr-slot.src { font-weight: 500; }
  .wfr-slot.dst { display: flex; flex-direction: column; align-items: stretch; gap: 0.25rem; }
  .wfr-slot-label {
    color: var(--theme-caption-color);
    font-size: 0.9375rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wfr-slot-tag {
    margin-left: auto;
    font-size: 0.6875rem;
    color: var(--theme-dark-color);
    padding: 0.0625rem 0.375rem;
    border-radius: 0.25rem;
    background: var(--theme-button-pressed);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .wfr-connector {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--theme-dark-color);
  }
  .wfr-slot-preview {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.8125rem;
    color: var(--theme-dark-color);
    padding-left: 0.25rem;
    opacity: 0.85;
  }
  .wfr-footer-note {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    background: var(--theme-list-row-color);
    border-left: 3px solid var(--theme-progress-color);
    font-size: 0.8125rem;
    color: var(--theme-dark-color);
  }
  .grow { min-width: 0; }
</style>
