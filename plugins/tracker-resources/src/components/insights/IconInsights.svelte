<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  export let size: 'small' | 'medium' | 'large'
  const fill: string = 'currentColor'
</script>

<!-- A graph: axes with three bars -->
<svg class="svg-{size}" {fill} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 4H6V26H28V28H4V4Z" />
  <path d="M9 16H13V24H9V16ZM15 8H19V24H15V8ZM21 12H25V24H21V12Z" />
</svg>
