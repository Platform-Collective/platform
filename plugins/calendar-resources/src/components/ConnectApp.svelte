<!--
//
// Copyright © 2023 Hardcore Engineering Inc.
//
-->
<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import calendar from '../plugin'

  const error = new URLSearchParams(window.location.search).get('integrationError')

  if (error === null) {
    window.close()
  }
</script>

{#if error === calendar.string.NotAllPermissions}
  <Label label={calendar.string.NotAllPermissions} />
{:else if error !== null}
  <p>{error}</p>
{/if}
