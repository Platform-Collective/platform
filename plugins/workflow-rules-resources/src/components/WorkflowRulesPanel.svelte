<!-- SPDX-License-Identifier: EPL-2.0 -->
<!-- Copyright © 2026 Platform Collective Contributors -->
<script lang="ts">
  import { getCurrentAccount, type Ref } from '@hcengineering/core'
  import { createQuery, getClient, MessageBox, pluginConfigurationStore } from '@hcengineering/presentation'
  import tracker, { type Project } from '@hcengineering/tracker'
  import {
    Breadcrumbs,
    Button,
    ButtonIcon,
    Header,
    IconAdd,
    IconDelete,
    Label,
    Scroller,
    Toggle,
    showPopup
  } from '@hcengineering/ui'
  import { workflowRulesId, type WorkflowRule } from '@hcengineering/workflow-rules'

  import workflowRules from '../plugin'
  import PairProjectEditor from './PairProjectEditor.svelte'
  import EditWorkflowRule from './EditWorkflowRule.svelte'

  export let currentSpace: Ref<Project>

  const client = getClient()
  const localRulesQ = createQuery()
  const incomingRulesQ = createQuery()
  const projectsQ = createQuery()

  let localRules: WorkflowRule[] = []
  let incomingRules: WorkflowRule[] = []
  let projectsById: Record<string, Project> = {}

  // The currentSpace's own Project doc, used for the member/owner gate on
  // this project's actions.
  let currentProject: Project | undefined

  $: localRulesQ.query(workflowRules.class.WorkflowRule, { space: currentSpace }, (res) => {
    localRules = res as unknown as WorkflowRule[]
  })

  $: incomingRulesQ.query(workflowRules.class.WorkflowRule, { linkedProject: currentSpace }, (res) => {
    incomingRules = res as unknown as WorkflowRule[]
  })

  $: projectsQ.query(tracker.class.Project, {}, (res) => {
    const next: Record<string, Project> = {}
    for (const p of res) next[p._id] = p
    projectsById = next
    currentProject = next[currentSpace as string]
  })

  // Plugin enablement. The server trigger is a no-op when disabled, so a
  // rule saved from here would silently never fire. Mirror that in the UI.
  $: pluginEnabled = $pluginConfigurationStore.has(workflowRulesId)

  // Member/owner on the current (primary-side) project. Edits here write
  // the forward rule into currentSpace; actions are hidden otherwise.
  $: canEditHere = currentProject !== undefined && isMemberOf(currentProject)

  function isMemberOf(p: Project | undefined): boolean {
    if (p === undefined) return false
    const me = getCurrentAccount().uuid
    const members = Array.isArray(p.members) ? p.members : []
    const owners = Array.isArray(p.owners) ? p.owners : []
    return members.includes(me) || owners.includes(me)
  }

  // A pair "from here" has its forward rule in currentSpace. The reverse
  // rule, if the pair is bidirectional, lives in the linked project.
  interface PrimaryPairing {
    kind: 'primary'
    other: Ref<Project>
    forward: WorkflowRule
    reverse: WorkflowRule | undefined
  }

  interface IncomingPairing {
    kind: 'incoming'
    other: Ref<Project>
    inbound: WorkflowRule
    hasReverseHere: boolean
  }

  // Primary pairings: each forward rule in currentSpace is one; the reverse
  // rule is the one in the linked project whose `linkedProject` is us.
  $: primaryPairings = (() => {
    const out: PrimaryPairing[] = []
    for (const r of localRules) {
      const reverse = incomingRules.find((rr) => rr.space === r.linkedProject && rr.linkedProject === currentSpace)
      out.push({ kind: 'primary', other: r.linkedProject, forward: r, reverse })
    }
    return out
  })()

  // Incoming pairings: a rule whose linkedProject is us AND whose space is
  // NOT already covered by a primary pairing (i.e. the local side is a pure
  // target). The user has to open the other project to edit it.
  $: incomingPairings = (() => {
    const out: IncomingPairing[] = []
    const primaryOthers = new Set(primaryPairings.map((p) => p.other as string))
    for (const r of incomingRules) {
      if (primaryOthers.has(r.space as string)) continue
      // See if there is a reverse rule (we'd be the primary side), but that
      // case is already covered by primaryPairings above. This path is just
      // "incoming only", one-way into this project.
      out.push({ kind: 'incoming', other: r.space, inbound: r, hasReverseHere: false })
    }
    return out
  })()

  function openCreate(): void {
    if (!pluginEnabled || !canEditHere) return
    showPopup(PairProjectEditor, { currentSpace }, 'center')
  }

  function openEditPair(p: PrimaryPairing): void {
    if (!pluginEnabled || !canEditHere) return
    showPopup(
      PairProjectEditor,
      {
        currentSpace,
        existingForward: p.forward,
        existingReverse: p.reverse
      },
      'center'
    )
  }

  function openAdvanced(p: PrimaryPairing): void {
    if (!pluginEnabled || !canEditHere) return
    showPopup(EditWorkflowRule, { currentSpace, rule: p.forward, partner: p.reverse }, 'center')
  }

  function navigateToPrimary(p: IncomingPairing): void {
    // The primary lives in p.other project. We can only link to its settings
    // tab from here; the user has to be a member there to actually edit.
    // For now this is a best-effort info dialog since the workbench navigator
    // model does not expose a stable "open project special" API; a follow-up
    // can add deep linking.
    showPopup(
      MessageBox,
      {
        label: workflowRules.string.EditFromPrimary,
        message: workflowRules.string.EditFromPrimary,
        canSubmit: false
      },
      'center'
    )
  }

  async function toggleEnabled(p: PrimaryPairing): Promise<void> {
    if (!pluginEnabled || !canEditHere) return
    const now = !p.forward.enabled
    const ops = client.apply()
    ops.updateDoc(workflowRules.class.WorkflowRule, p.forward.space, p.forward._id, { enabled: now })
    if (p.reverse !== undefined) {
      ops.updateDoc(workflowRules.class.WorkflowRule, p.reverse.space, p.reverse._id, { enabled: now })
    }
    await ops.commit()
  }

  function confirmRemove(p: PrimaryPairing): void {
    if (!pluginEnabled || !canEditHere) return
    showPopup(
      MessageBox,
      {
        label: workflowRules.string.DeleteConfirmTitle,
        message: workflowRules.string.DeleteConfirmMessage,
        action: async () => {
          await remove(p)
        }
      },
      'center'
    )
  }

  async function remove(p: PrimaryPairing): Promise<void> {
    const ops = client.apply()
    ops.removeDoc(workflowRules.class.WorkflowRule, p.forward.space, p.forward._id)
    if (p.reverse !== undefined) {
      ops.removeDoc(workflowRules.class.WorkflowRule, p.reverse.space, p.reverse._id)
    }
    await ops.commit()
  }

  function otherName(id: Ref<Project>): string {
    const p = projectsById[id]
    return p !== undefined ? p.name : String(id)
  }

  function otherIdent(id: Ref<Project>): string {
    const p = projectsById[id]
    return p !== undefined ? p.identifier : ''
  }

  function fwdMappings(p: PrimaryPairing): number {
    return Object.keys(p.forward.forwardMap ?? {}).length
  }

  function revMappings(p: PrimaryPairing): number {
    return p.reverse !== undefined ? Object.keys(p.reverse.forwardMap ?? {}).length : 0
  }

  function cardKeydown(event: KeyboardEvent, action: () => void): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      action()
    }
  }
</script>

<Header adaptive={'doubleRow'}>
  <Breadcrumbs items={[{ icon: workflowRules.icon.WorkflowRule, label: workflowRules.string.WorkflowRules }]} />
  <svelte:fragment slot="actions">
    {#if pluginEnabled && canEditHere}
      <Button
        icon={IconAdd}
        label={workflowRules.string.PairProjects}
        kind={'primary'}
        on:click={openCreate}
      />
    {/if}
  </svelte:fragment>
</Header>

<Scroller>
  <div class="wfr-panel">
    {#if !pluginEnabled}
      <div class="wfr-notice">
        <div class="wfr-notice-title"><Label label={workflowRules.string.PluginDisabled} /></div>
        <div class="wfr-notice-sub"><Label label={workflowRules.string.PluginDisabledHint} /></div>
      </div>
    {:else if !canEditHere && primaryPairings.length === 0 && incomingPairings.length === 0}
      <div class="wfr-notice">
        <div class="wfr-notice-sub"><Label label={workflowRules.string.NotMemberHere} /></div>
      </div>
    {:else if primaryPairings.length === 0 && incomingPairings.length === 0}
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
          <Button icon={IconAdd} label={workflowRules.string.PairProjects} kind="primary" on:click={openCreate} />
        </div>
      </div>
    {:else}
      {#if primaryPairings.length > 0}
        <section class="wfr-section">
          <div class="wfr-section-head"><Label label={workflowRules.string.PairsFromHere} /></div>
          <div class="wfr-list-head">
            <span><Label label={workflowRules.string.LinkedProject} /></span>
            <span><Label label={workflowRules.string.Direction} /></span>
            <span><Label label={workflowRules.string.Statuses} /></span>
            <span><Label label={workflowRules.string.Status} /></span>
            <span />
          </div>
          {#each primaryPairings as pair (pair.forward._id)}
            <article class="wfr-card" class:disabled={!pair.forward.enabled}>
              <div
                class="wfr-card-main"
                on:click={() => openEditPair(pair)}
                on:keydown={(e) => cardKeydown(e, () => openEditPair(pair))}
                role="button"
                tabindex="0"
                aria-disabled={!canEditHere}
              >
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
                  <span class="wfr-count-label"><Label label={workflowRules.string.Statuses} /></span>
                </div>
                <div class="wfr-cell state">
                  <div class="wfr-dot" class:on={pair.forward.enabled} />
                  <span>
                    <Label label={pair.forward.enabled ? workflowRules.string.Active : workflowRules.string.Paused} />
                  </span>
                </div>
              </div>
              <div class="wfr-card-actions" on:click|stopPropagation on:keydown|stopPropagation role="toolbar">
                <Toggle on={pair.forward.enabled} disabled={!canEditHere} on:change={() => toggleEnabled(pair)} />
                <Button
                  label={workflowRules.string.Advanced}
                  kind="ghost"
                  size="small"
                  disabled={!canEditHere}
                  on:click={() => openAdvanced(pair)}
                />
                <ButtonIcon
                  icon={IconDelete}
                  size="small"
                  kind="ghost"
                  disabled={!canEditHere}
                  on:click={() => confirmRemove(pair)}
                />
              </div>
            </article>
          {/each}
        </section>
      {/if}

      {#if incomingPairings.length > 0}
        <section class="wfr-section">
          <div class="wfr-section-head"><Label label={workflowRules.string.IncomingPairs} /></div>
          {#each incomingPairings as pair (pair.inbound._id)}
            <article class="wfr-card incoming">
              <div class="wfr-card-main readonly">
                <div class="wfr-cell project">
                  <div class="wfr-proj-badge">{otherIdent(pair.other) || '•'}</div>
                  <div class="wfr-proj-text">
                    {#if pair.inbound.name !== undefined && pair.inbound.name.length > 0}
                      <div class="wfr-proj-name">{pair.inbound.name}</div>
                      <div class="wfr-proj-sub">{otherName(pair.other)}</div>
                    {:else}
                      <div class="wfr-proj-name">{otherName(pair.other)}</div>
                    {/if}
                  </div>
                </div>
                <div class="wfr-cell direction">
                  <span class="wfr-direction one-way"><Label label={workflowRules.string.OneWay} /></span>
                </div>
                <div class="wfr-cell mapping-count">
                  <span class="wfr-count">{Object.keys(pair.inbound.forwardMap ?? {}).length}</span>
                  <span class="wfr-count-label"><Label label={workflowRules.string.Statuses} /></span>
                </div>
                <div class="wfr-cell state">
                  <div class="wfr-dot" class:on={pair.inbound.enabled} />
                  <span>
                    <Label label={pair.inbound.enabled ? workflowRules.string.Active : workflowRules.string.Paused} />
                  </span>
                </div>
              </div>
              <div class="wfr-card-actions" on:click|stopPropagation on:keydown|stopPropagation role="toolbar">
                <Button
                  label={workflowRules.string.OpenPrimary}
                  kind="ghost"
                  size="small"
                  on:click={() => navigateToPrimary(pair)}
                />
              </div>
            </article>
          {/each}
        </section>
      {/if}
    {/if}
  </div>
</Scroller>

<style lang="scss">
  .wfr-panel {
    padding: 1.5rem 1.75rem 2rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    max-width: 72rem;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
  }
  .wfr-section { display: flex; flex-direction: column; gap: 0.5rem; }
  .wfr-section-head {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
    padding: 0 0.25rem;
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
  .wfr-card:hover { border-color: var(--theme-caret-color); background: var(--theme-bg-accent-color); }
  .wfr-card.disabled { opacity: 0.6; }
  .wfr-card.incoming { opacity: 0.9; border-style: dashed; }
  .wfr-card-main {
    display: grid;
    grid-template-columns: minmax(14rem, 2fr) 7rem 10rem 7rem;
    gap: 1rem;
    padding: 1rem 1.25rem;
    cursor: pointer;
    align-items: center;
  }
  .wfr-card-main.readonly { cursor: default; }
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
  .wfr-direction.one-way { background: transparent; color: var(--theme-dark-color); }
  .wfr-count { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--theme-caption-color); font-size: 0.9375rem; }
  .wfr-count-sep { color: var(--theme-dark-color); font-size: 0.875rem; }
  .wfr-count-label { color: var(--theme-dark-color); font-size: 0.75rem; margin-left: 0.25rem; }
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
  .wfr-empty-title { color: var(--theme-caption-color); font-size: 1rem; font-weight: 600; }
  .wfr-empty-sub { color: var(--theme-dark-color); font-size: 0.875rem; max-width: 28rem; }
  .wfr-empty-cta { margin-top: 0.75rem; }
  .wfr-notice {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 1.25rem 1.5rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.75rem;
    background: var(--theme-list-row-color);
  }
  .wfr-notice-title { color: var(--theme-caption-color); font-weight: 600; font-size: 0.9375rem; }
  .wfr-notice-sub { color: var(--theme-dark-color); font-size: 0.875rem; }
</style>
