<!--
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
-->
<script lang="ts">
  export let size: 'small' | 'medium' | 'large'
  const fill: string = 'currentColor'
</script>

<svg class="svg-{size}" {fill} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <path
    fill-rule="evenodd"
    clip-rule="evenodd"
    d="M6 4C3.79086 4 2 5.79086 2 8V24C2 26.2091 3.79086 28 6 28H26C28.2091 28 30 26.2091 30 24V8C30 5.79086 28.2091 4 26 4H6ZM12 6H6C4.89543 6 4 6.89543 4 8V24C4 25.1046 4.89543 26 6 26H12V6ZM14 6V26H26C27.1046 26 28 25.1046 28 24V8C28 6.89543 27.1046 6 26 6H14Z"
  />
  <path d="M6 10H10V12H6V10ZM6 14H10V16H6V14ZM6 18H10V20H6V18Z" />
</svg>
