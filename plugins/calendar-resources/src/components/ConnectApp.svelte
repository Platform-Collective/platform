<!--
//
// Copyright © 2023 Hardcore Engineering Inc.
//
-->
<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import { onMount } from 'svelte'
  import calendar from '../plugin'

  const integrationError = new URLSearchParams(window.location.search).get('integrationError')
  const error = integrationError === null
    ? null
    : integrationError === calendar.string.NotAllPermissions
      ? calendar.string.NotAllPermissions
      : calendar.string.IntegrationFailed

  onMount(() => {
    if (window.opener !== null && !window.opener.closed) {
      window.opener.postMessage({ type: 'calendar-auth-result', error }, window.location.origin)
    }
    if (error === null) {
      window.close()
    }
  })
</script>

{#if error !== null}
  <div role="alert"><Label label={error} /></div>
{/if}
