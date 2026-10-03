<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import type { IntlString } from '@hcengineering/platform'
  import presentation, { Card } from '@hcengineering/presentation'
  import { Button, Label } from '@hcengineering/ui'

  // The frame of the editors of the project settings (fields, workflows, webhooks, archived items). Shown as a popup
  // it is the `Card` they always used; embedded in a section of the settings page it is the plain section.
  export let embedded: boolean = false
  export let label: IntlString
  export let okLabel: IntlString = presentation.string.Save
  export let okAction: () => Promise<void> | void = () => {}
  export let canSave: boolean = false
  export let hideFooter: boolean = false
  export let isBack: boolean = false
  export let backAction: () => Promise<void> | void = () => {}
  export let onCancel: (() => void) | undefined = undefined
  export let width: 'large' | 'medium' | 'small' | 'x-small' | 'menu' = 'medium'

  let saving = false
  async function save (): Promise<void> {
    saving = true
    try {
      await okAction()
    } finally {
      saving = false
    }
  }
</script>

{#if embedded}
  <section class="settings-section">
    <div class="section-header">
      <span class="section-title"><Label {label} /></span>
    </div>
    <div class="section-body">
      <slot />
    </div>
    {#if !hideFooter}
      <div class="section-footer">
        <Button label={okLabel} kind={'primary'} loading={saving} disabled={!canSave} on:click={save} />
        {#if isBack}
          <Button label={presentation.string.Cancel} kind={'regular'} on:click={backAction} />
        {/if}
      </div>
    {/if}
  </section>
{:else}
  <Card
    {label}
    {okLabel}
    {okAction}
    {canSave}
    {hideFooter}
    {isBack}
    {backAction}
    {onCancel}
    {width}
    accentHeader
    gap={'gapV-4'}
    on:close
    on:changeContent
  >
    <slot />
  </Card>
{/if}

<style lang="scss">
  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
  }
  .section-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .section-title {
    font-size: 1.25rem;
    font-weight: 500;
    color: var(--theme-caption-color);
  }
  .section-body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-width: 0;
  }
  .section-footer {
    display: flex;
    gap: 0.5rem;
  }
</style>
