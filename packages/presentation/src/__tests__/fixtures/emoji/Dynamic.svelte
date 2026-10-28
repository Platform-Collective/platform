<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import Popup from '../../../../../../plugins/emoji-resources/src/components/EmojiPopup.svelte'

  export let props: { selected?: string, disabled?: boolean } = {}
</script>

<Popup {...props} selected={props.selected} on:close />
