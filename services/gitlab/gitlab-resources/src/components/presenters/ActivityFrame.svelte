<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  // A palette color frames the activity message; undefined leaves it unframed
  export let color: string | undefined
</script>

<div class:framed={color !== undefined} style:border-color={color}>
  <slot />
</div>

<style lang="scss">
  .framed {
    border: 1px solid;
    border-radius: 0.5rem;
    margin: 0.25rem 0;
  }
</style>
