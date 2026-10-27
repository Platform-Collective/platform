<!-- SPDX-License-Identifier: EPL-2.0 -->
<!-- Copyright © 2026 Platform Collective Contributors -->
<script lang="ts">
  import { type Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tracker, { type Project } from '@hcengineering/tracker'
  import { Breadcrumbs, Button, Header, IconAdd, IconDelete, Label, Scroller, Toggle, ButtonIcon, showPopup } from '@hcengineering/ui'
  import { type WorkflowRule } from '@hcengineering/workflow-rules'

  import workflowRules from '../plugin'
  import PairProjectEditor from './PairProjectEditor.svelte'
  import EditWorkflowRule from './EditWorkflowRule.svelte'

  export let currentSpace: Ref<Project>

  const client = getClient()
  const localRulesQ = createQuery()
  const reverseRulesQ = createQuery()
  const projectsQ = createQuery()

  let localRules: WorkflowRule[] = []
  let reverseRules: WorkflowRule[] = []
  let projectsById: Record<string, Project> = {}

  $: localRulesQ.query(
    workflowRules.class.WorkflowRule,
    { space: currentSpace },
    (res) => { localRules = res as unknown as WorkflowRule[] }
  )

  $: reverseRulesQ.query(
    workflowRules.class.WorkflowRule,
    { linkedProject: currentSpace },
    (res) => { reverseRules = res as unknown as WorkflowRule[] }
  )

  $: projectsQ.query(tracker.class.Project, {}, (res) => {
    const next: Record<string, Project> = {}
    for (const p of res) next[p._id] = p
    projectsById = next
  })

  type Pairing = {
    other: Ref<Project>
    forward: WorkflowRule
    reverse: WorkflowRule | undefined
  }

  $: pairings = (() => {
    const out: Pairing[] = []
    for (const r of localRules) {
      const rev = reverseRules.find((rr) => rr.space === r.linkedProject && rr.linkedProject === currentSpace)
      out.push({ other: r.linkedProject, forward: r, reverse: rev })
    }
    return out
  })()

  function openCreate (): void {
    showPopup(PairProjectEditor, { currentSpace }, 'center')
  }
  function openEditPair (p: Pairing): void {
    showPopup(PairProjectEditor, {
      currentSpace,
      existingForward: p.forward,
      existingReverse: p.reverse
    }, 'center')
  }
  function openAdvanced (rule: WorkflowRule): void {
    showPopup(EditWorkflowRule, { currentSpace, rule }, 'center')
  }
  async function toggleEnabled (p: Pairing): Promise<void> {
    const now = !p.forward.enabled
    await client.updateDoc(workflowRules.class.WorkflowRule, p.forward.space, p.forward._id, { enabled: now })
    if (p.reverse !== undefined) {
      await client.updateDoc(workflowRules.class.WorkflowRule, p.reverse.space, p.reverse._id, { enabled: now })
    }
  }
  async function remove (p: Pairing): Promise<void> {
    await client.removeDoc(workflowRules.class.WorkflowRule, p.forward.space, p.forward._id)
    if (p.reverse !== undefined) {
      await client.removeDoc(workflowRules.class.WorkflowRule, p.reverse.space, p.reverse._id)
    }
  }
  function otherName (id: Ref<Project>): string {
    const p = projectsById[id]
    return p !== undefined ? p.name : String(id)
  }
  function otherIdent (id: Ref<Project>): string {
    const p = projectsById[id]
    return p !== undefined ? p.identifier : ''
  }
  function fwdMappings (p: Pairing): number { return Object.keys(p.forward.forwardMap ?? {}).length }
  function revMappings (p: Pairing): number { return p.reverse !== undefined ? Object.keys(p.reverse.forwardMap ?? {}).length : 0 }
</script>

<Header adaptive={'doubleRow'}>
  <Breadcrumbs items={[{ icon: workflowRules.icon.WorkflowRule, label: workflowRules.string.WorkflowRules }]} />
  <svelte:fragment slot="actions">
    <Button
      icon={IconAdd}
      label={workflowRules.string.PairProjects}
      kind={'primary'}
      on:click={openCreate}
    />
  </svelte:fragment>
</Header>

<Scroller>
  <div class="wfr-panel">
    {#if pairings.length === 0}
      <div class="wfr-empty">
        <div class="wfr-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2.5" y="4" width="7" height="7" rx="1.5" />
            <rect x="14.5" y="13" width="7" height="7" rx="1.5" />
            <path d="M9.5 7.5 h3 a2.5 2.5 0 0 1 2.5 2.5 v3" opacity="0.6" />
          </svg>
        </div>
        <div class="wfr-empty-title"><Label label={workflowRules.string.NoRulesYet} /></div>
        <div class="wfr-empty-sub"><Label label={workflowRules.string.EmptyHint} /></div>
        <div class="wfr-empty-cta">
          <Button
            icon={IconAdd}
            label={workflowRules.string.PairProjects}
            kind="primary"
            on:click={openCreate}
          />
        </div>
      </div>
    {:else}
      <div class="wfr-list-head">
        <span>Linked project</span>
        <span>Direction</span>
        <span>Mappings</span>
        <span>Status</span>
        <span />
      </div>
      {#each pairings as pair (pair.forward._id)}
        <article class="wfr-card" class:disabled={!pair.forward.enabled}>
          <div class="wfr-card-main" on:click={() => openEditPair(pair)} on:keydown role="button" tabindex="0">
            <div class="wfr-cell project">
              <div class="wfr-proj-badge">{otherIdent(pair.other) || '•'}</div>
              <div class="wfr-proj-text">
                {#if pair.forward.name !== undefined && pair.forward.name.length > 0}
                  <div class="wfr-proj-name">{pair.forward.name}</div>
                  <div class="wfr-proj-sub">{otherName(pair.other)}</div>
                {:else}
                  <div class="wfr-proj-name">{otherName(pair.other)}</div>
                {/if}
              </div>
            </div>
            <div class="wfr-cell direction">
              {#if pair.reverse !== undefined}
                <span class="wfr-direction two-way"><Label label={workflowRules.string.Bidirectional} /></span>
              {:else}
                <span class="wfr-direction one-way"><Label label={workflowRules.string.OneWay} /></span>
              {/if}
            </div>
            <div class="wfr-cell mapping-count">
              <span class="wfr-count">{fwdMappings(pair)}</span>
              {#if pair.reverse !== undefined}
                <span class="wfr-count-sep">+</span>
                <span class="wfr-count">{revMappings(pair)}</span>
              {/if}
              <span class="wfr-count-label">statuses</span>
            </div>
            <div class="wfr-cell state">
              <div class="wfr-dot" class:on={pair.forward.enabled} />
              <span>{pair.forward.enabled ? 'Active' : 'Paused'}</span>
            </div>
          </div>
          <div class="wfr-card-actions" on:click|stopPropagation>
            <Toggle on={pair.forward.enabled} on:change={() => toggleEnabled(pair)} />
            <Button
              label={workflowRules.string.Advanced}
              kind="ghost"
              size="small"
              on:click={() => openAdvanced(pair.forward)}
            />
            <ButtonIcon icon={IconDelete} size="small" kind="ghost" on:click={() => remove(pair)} />
          </div>
        </article>
      {/each}
    {/if}
  </div>
</Scroller>

<style lang="scss">
  .wfr-panel {
    padding: 1.5rem 1.75rem 2rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 72rem;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
  }
  .wfr-list-head {
    display: grid;
    grid-template-columns: minmax(14rem, 2fr) 7rem 10rem 7rem 10rem;
    gap: 1rem;
    padding: 0 1.25rem 0.5rem;
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--theme-dark-color);
    font-weight: 600;
  }
  .wfr-card {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: stretch;
    background: var(--theme-list-row-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.75rem;
    transition: border-color 180ms ease, background 180ms ease, transform 180ms ease;
  }
  .wfr-card:hover {
    border-color: var(--theme-caret-color);
    background: var(--theme-bg-accent-color);
  }
  .wfr-card.disabled { opacity: 0.6; }
  .wfr-card-main {
    display: grid;
    grid-template-columns: minmax(14rem, 2fr) 7rem 10rem 7rem;
    gap: 1rem;
    padding: 1rem 1.25rem;
    cursor: pointer;
    align-items: center;
  }
  .wfr-cell { display: flex; align-items: center; gap: 0.625rem; min-width: 0; }
  .wfr-cell.project { gap: 0.75rem; }
  .wfr-proj-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2.25rem;
    height: 2.25rem;
    padding: 0 0.5rem;
    border-radius: 0.5rem;
    background: var(--theme-button-pressed);
    color: var(--theme-caption-color);
    font-weight: 600;
    font-size: 0.75rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .wfr-proj-text { display: flex; flex-direction: column; min-width: 0; }
  .wfr-proj-name {
    color: var(--theme-caption-color);
    font-weight: 500;
    font-size: 0.9375rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wfr-proj-sub {
    color: var(--theme-dark-color);
    font-size: 0.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wfr-direction {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.625rem;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border: 1px solid var(--theme-divider-color);
  }
  .wfr-direction.two-way {
    background: var(--theme-progress-color);
    color: var(--theme-caption-color);
    border-color: transparent;
  }
  .wfr-direction.one-way {
    background: transparent;
    color: var(--theme-dark-color);
  }
  .wfr-count {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: var(--theme-caption-color);
    font-size: 0.9375rem;
  }
  .wfr-count-sep { color: var(--theme-dark-color); font-size: 0.875rem; }
  .wfr-count-label {
    color: var(--theme-dark-color);
    font-size: 0.75rem;
    margin-left: 0.25rem;
  }
  .wfr-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--theme-dark-color);
    opacity: 0.5;
  }
  .wfr-dot.on {
    background: var(--theme-progress-color);
    opacity: 1;
    box-shadow: 0 0 0 2px var(--theme-list-row-color), 0 0 0 3px var(--theme-progress-color);
  }
  .wfr-card-actions {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.75rem 1rem;
    border-left: 1px solid var(--theme-divider-color);
  }
  .wfr-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 4rem 2rem;
    text-align: center;
    border: 1px dashed var(--theme-divider-color);
    border-radius: 0.875rem;
    background: var(--theme-list-row-color);
  }
  .wfr-empty-icon { color: var(--theme-dark-color); opacity: 0.55; }
  .wfr-empty-title {
    color: var(--theme-caption-color);
    font-size: 1rem;
    font-weight: 600;
  }
  .wfr-empty-sub {
    color: var(--theme-dark-color);
    font-size: 0.875rem;
    max-width: 28rem;
  }
  .wfr-empty-cta { margin-top: 0.75rem; }
</style>
