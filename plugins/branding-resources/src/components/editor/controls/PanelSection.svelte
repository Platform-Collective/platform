<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import type { IntlString } from '@hcengineering/platform'
  import { Label } from '@hcengineering/ui'

  export let label: IntlString
  export let columns: number = 2
</script>

<div class="section">
  <div class="title"><Label {label} /><slot name="tools" /></div>
  <div class="grid" style:grid-template-columns={`repeat(${columns}, minmax(0, 1fr))`}>
    <slot />
  </div>
</div>

<style lang="scss">
  .section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: 600;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--theme-dark-color);
  }
  .grid {
    display: grid;
    gap: 0.5rem;
  }
  .grid :global(.full) {
    grid-column: 1 / -1;
  }
</style>
