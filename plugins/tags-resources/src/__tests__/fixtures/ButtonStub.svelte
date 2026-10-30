<!-- SPDX-License-Identifier: EPL-2.0 -->
<!-- Forward real clicks so interaction tests can open the production editor's popup. -->
<script lang="ts">
  export let id: string = ''
</script>

<button {id} on:click><slot /></button>
