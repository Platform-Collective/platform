<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { Icon, showPopup } from '@hcengineering/ui'
  import gitlab from '../plugin'
  import GitlabImagePopup from './GitlabImagePopup.svelte'

  export let href: string

  function open (): void {
    showPopup(GitlabImagePopup, { href }, 'centered')
  }
</script>

<a
  class="gitlab-image-link"
  {href}
  target="_blank"
  rel="noopener noreferrer"
  on:click|preventDefault|stopPropagation={open}
  on:contextmenu|stopPropagation
>
  <Icon icon={gitlab.icon.Image} size="small" />
  <span><slot /></span>
</a>

<style lang="scss">
  .gitlab-image-link {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    vertical-align: bottom;
  }
</style>
