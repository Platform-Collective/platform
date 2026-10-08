<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import { Label, tooltip } from '@hcengineering/ui'
  import tracker from '../../plugin'

  // Marks a draft item (GitHub Projects "Draft"): an item of the project that is not an issue yet
  export let kind: 'list' | 'panel' = 'list'
</script>

<span
  class="draft-badge"
  class:panel={kind === 'panel'}
  data-id="draft-badge"
  use:tooltip={{ label: tracker.string.DraftItemTooltip }}
>
  <Label label={tracker.string.Draft} />
</span>

<style lang="scss">
  .draft-badge {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    padding: 0 0.375rem;
    height: 1.125rem;
    font-size: 0.6875rem;
    line-height: 1;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.75rem;
    color: var(--theme-halfcontent-color);
    background-color: var(--theme-bg-accent-color);
    cursor: default;

    &.panel {
      height: 1.375rem;
      padding: 0 0.5rem;
      font-size: 0.75rem;
    }
  }
</style>
