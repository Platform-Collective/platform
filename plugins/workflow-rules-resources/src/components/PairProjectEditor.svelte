<!-- SPDX-License-Identifier: EPL-2.0 -->
<!-- Copyright © 2026 Platform Collective Contributors -->
<script lang="ts">
  import { generateId, getCurrentAccount, type Ref } from '@hcengineering/core'
  import { Card, createQuery, getClient } from '@hcengineering/presentation'
  import task, { type ProjectType, type TaskType } from '@hcengineering/task'
  import tracker, { type IssueStatus, type Project } from '@hcengineering/tracker'
  import { IssueStatusIcon } from '@hcengineering/tracker-resources'
  import { Button, DropdownLabels, EditBox, Icon, Label, Toggle, IconArrowRight, type DropdownTextItem } from '@hcengineering/ui'
  import { type WorkflowRule } from '@hcengineering/workflow-rules'
  import { createEventDispatcher } from 'svelte'

  import workflowRules from '../plugin'

  export let currentSpace: Ref<Project>
  export let existingForward: WorkflowRule | undefined = undefined
  export let existingReverse: WorkflowRule | undefined = undefined

  const client = getClient()
  const dispatch = createEventDispatcher()

  const TERMINAL = new Set([task.statusCategory.Won, task.statusCategory.Lost])
  const RESTRICTED_KEY = 'restricted' as const

  interface StatusEntry {
    id: Ref<IssueStatus>
    name: string
    category: string | undefined
    status: IssueStatus
  }

  const projectsQ = createQuery()
  const pairedQ = createQuery()
  let allProjects: Project[] = []
  let projectsById: Record<string, Project> = {}

  // Rules already defined in currentSpace: used to prevent two pairings
  // against the same linked project.
  let siblingRules: WorkflowRule[] = []

  $: projectsQ.query(tracker.class.Project, {}, (res) => {
    allProjects = res as Project[]
    const map: Record<string, Project> = {}
    for (const p of res) map[p._id] = p
    projectsById = map
  })

  $: pairedQ.query(workflowRules.class.WorkflowRule, { space: currentSpace }, (res) => {
    siblingRules = res as unknown as WorkflowRule[]
  })

  const isEditing = existingForward !== undefined
  // Defensive: the panel should only open this editor from the primary side,
  // but if a stale caller passes a non-primary forward rule, refuse to show
  // a destructive save by disabling the OK button.
  const primaryMismatch = isEditing && existingForward !== undefined && existingForward.space !== currentSpace

  let linkedProject: Ref<Project> | undefined = existingForward?.linkedProject
  let name: string = existingForward?.name ?? ''
  let bidirectional = !(isEditing && existingReverse === undefined)

  let sourceStatuses: StatusEntry[] = []
  let targetStatuses: StatusEntry[] = []
  let forwardMap: Record<string, string> = {}
  let reverseMap: Record<string, string> = {}
  let loadingStatuses = false
  let loadToken = 0

  function currentUserMemberOf(p: Project): boolean {
    const me = getCurrentAccount().uuid
    const members = Array.isArray(p.members) ? p.members : []
    const owners = Array.isArray(p.owners) ? p.owners : []
    return members.includes(me) || owners.includes(me)
  }

  function isWritable(p: Project): boolean {
    if (p.archived === true) return false
    if ((p as unknown as Record<string, unknown>)[RESTRICTED_KEY] === true) return false
    return currentUserMemberOf(p)
  }

  // Projects offered as a pairing target. Excludes:
  //  - the current project (would be self-pairing),
  //  - archived / restricted targets (server would refuse to mirror anyway),
  //  - projects the current user is not a member/owner of (the reverse rule
  //    is written into THAT project's space, which the server authz check
  //    would refuse for a non-member),
  //  - projects already paired with current (prevents duplicate pairings).
  //  In edit mode the linked project is also excluded from the picker since
  //  the picker is disabled - but it would be filtered out by the
  //  already-paired rule anyway.
  $: candidateProjects = allProjects.filter((p) => {
    if (p._id === currentSpace) return false
    if (!isWritable(p)) return false
    const already = siblingRules.find((r) => r.linkedProject === p._id)
    if (already !== undefined) {
      // Allow the current pairing's target to stay in the list in edit
      // mode (even though the picker is disabled, the Dropdown still needs
      // to resolve the selected id's label).
      if (isEditing && already._id === existingForward?._id) return true
      return false
    }
    return true
  })

  $: projectItems = candidateProjects.map(
    (p) => ({ id: p._id, label: `${p.identifier}  ${p.name}` }) as DropdownTextItem
  )

  async function statusesOf(projId: Ref<Project> | undefined, token: number): Promise<StatusEntry[]> {
    if (projId === undefined) return []
    const proj = await client.findOne(tracker.class.Project, { _id: projId })
    if (proj === undefined || token !== loadToken) return []
    const ptype = await client.findOne<ProjectType>(task.class.ProjectType, { _id: proj.type })
    if (ptype === undefined || token !== loadToken) return []
    const ttId = ptype.tasks?.[0]
    if (ttId === undefined) return []
    const tt = await client.findOne<TaskType>(task.class.TaskType, { _id: ttId })
    if (tt === undefined || token !== loadToken) return []
    const out: StatusEntry[] = []
    const statusIds = (tt.statuses ?? []) as Array<Ref<IssueStatus>>
    for (const sid of statusIds) {
      const s = await client.findOne(tracker.class.IssueStatus, { _id: sid })
      if (token !== loadToken) return []
      if (s !== undefined) out.push({ id: sid, name: s.name, category: s.category, status: s })
    }
    return out
  }

  // Prefer category match over name match: category is a semantic hint from
  // the status model and survives renames; a name match that disagrees with
  // the category can be a false positive (e.g. two different "Review"
  // statuses in different categories).
  function autoMatch(src: StatusEntry, targets: StatusEntry[]): Ref<IssueStatus> | undefined {
    const sameCategory = targets.filter((t) => t.category === src.category)
    if (sameCategory.length > 0) {
      const sameName = sameCategory.find((t) => t.name.toLowerCase() === src.name.toLowerCase())
      return (sameName ?? sameCategory[0]).id
    }
    const nameOnly = targets.find((t) => t.name.toLowerCase() === src.name.toLowerCase())
    return nameOnly?.id
  }

  function buildAutoMap(src: StatusEntry[], dst: StatusEntry[]): Record<string, string> {
    const out: Record<string, string> = {}
    for (const s of src) {
      const t = autoMatch(s, dst)
      if (t !== undefined) out[s.id] = t
    }
    return out
  }

  function buildAllowedLoops(dstStatuses: StatusEntry[]): Array<{ from: Ref<IssueStatus>, to: Ref<IssueStatus> }> {
    const nonTerminal = dstStatuses.filter((s) => s.category === undefined || !TERMINAL.has(s.category as any))
    const loops: Array<{ from: Ref<IssueStatus>, to: Ref<IssueStatus> }> = []
    for (let i = 0; i < nonTerminal.length; i++) {
      for (let j = 0; j < i; j++) {
        loops.push({ from: nonTerminal[i].id, to: nonTerminal[j].id })
      }
    }
    return loops
  }

  async function onLinkedChange(target: Ref<Project> | undefined): Promise<void> {
    loadToken++
    const token = loadToken
    if (target === undefined) {
      sourceStatuses = []
      targetStatuses = []
      forwardMap = {}
      reverseMap = {}
      loadingStatuses = false
      return
    }
    loadingStatuses = true
    const src = await statusesOf(currentSpace, token)
    const dst = await statusesOf(target, token)
    if (token !== loadToken) return
    sourceStatuses = src
    targetStatuses = dst
    const seedForward = existingForward?.forwardMap
    const seedReverse = existingReverse?.forwardMap
    forwardMap =
      seedForward !== undefined && Object.keys(seedForward).length > 0
        ? ({ ...seedForward } as Record<string, string>)
        : buildAutoMap(src, dst)
    reverseMap =
      seedReverse !== undefined && Object.keys(seedReverse).length > 0
        ? ({ ...seedReverse } as Record<string, string>)
        : buildAutoMap(dst, src)
    loadingStatuses = false
  }

  // Only one place changes linkedProject: the picker. In edit mode the
  // picker is disabled so this never fires from user action.
  $: void onLinkedChange(linkedProject)

  $: targetMapItems = [
    { id: '', label: '' } as DropdownTextItem,
    ...targetStatuses.map((s) => ({ id: s.id, label: s.name }) as DropdownTextItem)
  ]
  $: sourceMapItems = [
    { id: '', label: '' } as DropdownTextItem,
    ...sourceStatuses.map((s) => ({ id: s.id, label: s.name }) as DropdownTextItem)
  ]

  function onPickLinked(detail: unknown): void {
    if (isEditing) return
    linkedProject = detail as Ref<Project>
  }

  function setForward(sourceId: string, detail: unknown): void {
    const t = (detail ?? '') as string
    const next = { ...forwardMap }
    if (t === '') { delete next[sourceId] } else { next[sourceId] = t }
    forwardMap = next
  }

  function setReverse(sourceId: string, detail: unknown): void {
    const t = (detail ?? '') as string
    const next = { ...reverseMap }
    if (t === '') { delete next[sourceId] } else { next[sourceId] = t }
    reverseMap = next
  }

  function resetMappings(): void {
    forwardMap = buildAutoMap(sourceStatuses, targetStatuses)
    reverseMap = buildAutoMap(targetStatuses, sourceStatuses)
  }

  function mappedTarget(sourceId: string, targets: StatusEntry[]): StatusEntry | undefined {
    const tid = forwardMap[sourceId]
    if (tid === undefined) return undefined
    return targets.find((t) => t.id === tid)
  }

  function mappedReverse(sourceId: string, sources: StatusEntry[]): StatusEntry | undefined {
    const tid = reverseMap[sourceId]
    if (tid === undefined) return undefined
    return sources.find((t) => t.id === tid)
  }

  function isTerminal(s: StatusEntry): boolean {
    return s.category !== undefined && TERMINAL.has(s.category as any)
  }

  // Linked project the user is actually authorized against. In edit mode
  // this is the saved target; in create mode it's whatever they picked.
  $: linkedProjectDoc = linkedProject !== undefined ? projectsById[linkedProject as string] : undefined
  $: targetWritable = linkedProjectDoc !== undefined && isWritable(linkedProjectDoc)

  $: canSave =
    !primaryMismatch &&
    linkedProject !== undefined &&
    targetWritable &&
    Object.keys(forwardMap).length > 0 &&
    !loadingStatuses

  async function save(): Promise<void> {
    if (!canSave || linkedProject === undefined) return
    const trimmedName = name.trim()
    const forwardLoops = buildAllowedLoops(targetStatuses)
    const reverseLoops = buildAllowedLoops(sourceStatuses)

    const ops = client.apply()
    // Preserve `enabled` on edit (don't force-resume a paused pair);
    // default to true on create.
    const forwardEnabled = existingForward?.enabled ?? true
    const forwardData: Partial<WorkflowRule> = {
      linkedProject,
      // In edit mode we keep the stored `linkKind` instead of hardcoding
      // a side; the panel only opens this editor from the primary side so
      // `subIssue` is the correct create-time default.
      linkKind: existingForward?.linkKind ?? 'subIssue',
      name: trimmedName.length > 0 ? trimmedName : undefined,
      forwardMap,
      allowedLoops: forwardLoops,
      enabled: forwardEnabled
    }
    if (existingForward !== undefined) {
      ops.updateDoc(workflowRules.class.WorkflowRule, existingForward.space, existingForward._id, forwardData)
    } else {
      ops.createDoc(workflowRules.class.WorkflowRule, currentSpace, forwardData as any, generateId() as any)
    }

    if (bidirectional) {
      const reverseEnabled = existingReverse?.enabled ?? true
      const reverseData: Partial<WorkflowRule> = {
        linkedProject: currentSpace,
        linkKind: existingReverse?.linkKind ?? 'parentIssue',
        name: trimmedName.length > 0 ? trimmedName : undefined,
        forwardMap: reverseMap,
        allowedLoops: reverseLoops,
        enabled: reverseEnabled
      }
      if (existingReverse !== undefined) {
        ops.updateDoc(workflowRules.class.WorkflowRule, existingReverse.space, existingReverse._id, reverseData)
      } else {
        ops.createDoc(workflowRules.class.WorkflowRule, linkedProject, reverseData as any, generateId() as any)
      }
    } else if (existingReverse !== undefined) {
      ops.removeDoc(workflowRules.class.WorkflowRule, existingReverse.space, existingReverse._id)
    }

    await ops.commit()
    dispatch('close')
  }
</script>

<Card
  label={isEditing ? workflowRules.string.EditPair : workflowRules.string.PairProjects}
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
        <EditBox bind:value={name} placeholder={workflowRules.string.NamePlaceholder} kind={'editbox'} />
      </div>
      <div class="wfr-field grow">
        <div class="wfr-field-label"><Label label={workflowRules.string.PairedWith} /></div>
        <DropdownLabels
          items={projectItems}
          selected={linkedProject}
          placeholder={workflowRules.string.SelectProject}
          disabled={isEditing}
          autoSelect={false}
          on:selected={(e) => onPickLinked(e.detail)}
        />
      </div>
      <div class="wfr-field compact">
        <div class="wfr-field-label"><Label label={workflowRules.string.SyncBothWays} /></div>
        <Toggle bind:on={bidirectional} />
      </div>
    </section>

    {#if primaryMismatch}
      <div class="wfr-placeholder">
        <div class="wfr-placeholder-title"><Label label={workflowRules.string.EditFromPrimary} /></div>
      </div>
    {:else if linkedProject === undefined}
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
    {:else if linkedProjectDoc !== undefined && !targetWritable}
      <div class="wfr-placeholder">
        <div class="wfr-placeholder-title"><Label label={workflowRules.string.NotMemberOfTarget} /></div>
      </div>
    {:else if loadingStatuses || sourceStatuses.length === 0 || targetStatuses.length === 0}
      <div class="wfr-placeholder">
        <div class="wfr-placeholder-sub"><Label label={workflowRules.string.LoadingStatuses} /></div>
      </div>
    {:else}
      <section class="wfr-section">
        <div class="wfr-section-head">
          <div class="wfr-section-title"><Label label={workflowRules.string.StatusMapping} /></div>
          <div class="wfr-section-caption"><Label label={workflowRules.string.StatusMappingHint} /></div>
          <Button
            label={workflowRules.string.ResetMapping}
            kind="ghost"
            size="small"
            on:click={resetMappings}
          />
        </div>
        <div class="wfr-map">
          {#each sourceStatuses as src (src.id)}
            {@const target = mappedTarget(src.id, targetStatuses)}
            <div class="wfr-map-row" class:terminal={isTerminal(src)}>
              <div class="wfr-slot src">
                <IssueStatusIcon value={src.status} size="small" />
                <span class="wfr-slot-label">{src.name}</span>
                {#if isTerminal(src)}
                  <span class="wfr-slot-tag"><Label label={workflowRules.string.Final} /></span>
                {/if}
              </div>
              <div class="wfr-connector">
                <Icon icon={IconArrowRight} size="small" />
              </div>
              <div class="wfr-slot dst">
                <DropdownLabels
                  items={targetMapItems}
                  selected={forwardMap[src.id] ?? ''}
                  width={'100%'}
                  placeholder={workflowRules.string.NoMirror}
                  autoSelect={false}
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
            <div class="wfr-section-title"><Label label={workflowRules.string.ReverseMapping} /></div>
            <div class="wfr-section-caption"><Label label={workflowRules.string.ReverseMappingHint} /></div>
          </div>
          <div class="wfr-map">
            {#each targetStatuses as t (t.id)}
              {@const back = mappedReverse(t.id, sourceStatuses)}
              <div class="wfr-map-row" class:terminal={isTerminal(t)}>
                <div class="wfr-slot src">
                  <IssueStatusIcon value={t.status} size="small" />
                  <span class="wfr-slot-label">{t.name}</span>
                  {#if isTerminal(t)}
                    <span class="wfr-slot-tag"><Label label={workflowRules.string.Final} /></span>
                  {/if}
                </div>
                <div class="wfr-connector">
                  <Icon icon={IconArrowRight} size="small" />
                </div>
                <div class="wfr-slot dst">
                  <DropdownLabels
                    items={sourceMapItems}
                    selected={reverseMap[t.id] ?? ''}
                    width={'100%'}
                    placeholder={workflowRules.string.NoMirror}
                    autoSelect={false}
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
  .wfr-section-caption { font-size: 0.8125rem; color: var(--theme-dark-color); }
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
