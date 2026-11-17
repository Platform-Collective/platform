<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { ButtonIcon, IconChevronDown, IconChevronRight } from '@hcengineering/ui'

  export let expanded: boolean = false
  export let label: string

  let button: HTMLButtonElement | undefined
  $: if (button !== undefined) {
    button.setAttribute('aria-label', label)
    button.setAttribute('aria-expanded', String(expanded))
  }
</script>

<ButtonIcon
  bind:element={button}
  icon={expanded ? IconChevronDown : IconChevronRight}
  kind="tertiary"
  size="small"
  on:click
/>
