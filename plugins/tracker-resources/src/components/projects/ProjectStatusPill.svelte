<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  import type { ProjectStatus } from '@hcengineering/tracker'
  import { Label } from '@hcengineering/ui'

  import { projectStatusColor, projectStatusLabel } from '../../projectDetails/status'

  // A project status as a coloured pill (GitHub shows the status of a project like this)
  export let status: ProjectStatus
  export let clickable: boolean = false
</script>

<span class="status-pill" class:clickable data-id={`project-status-${status}`} style:--status-color={projectStatusColor(status)}>
  <span class="dot" />
  <Label label={projectStatusLabel(status)} />
</span>

<style lang="scss">
  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.125rem 0.5rem;
    font-size: 0.75rem;
    white-space: nowrap;
    color: var(--status-color);
    background-color: color-mix(in srgb, var(--status-color) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--status-color) 45%, transparent);
    border-radius: 1rem;
  }
  .clickable {
    cursor: pointer;
  }
  .dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background-color: var(--status-color);
  }
</style>
