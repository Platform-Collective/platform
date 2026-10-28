<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import type { SvelteComponent } from 'svelte'

  const Popup: typeof SvelteComponent =
    require('../../../../../../plugins/emoji-resources/src/components/EmojiPopup.svelte').default

  export let props: { selected?: string, disabled?: boolean } = {}
</script>

<Popup {...props} selected={props.selected} on:close />
