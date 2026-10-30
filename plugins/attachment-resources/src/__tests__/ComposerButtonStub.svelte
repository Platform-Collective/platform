<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  export let disabled = false
  export let loading = false
</script>

<button disabled={disabled || loading} on:click>Send</button>
