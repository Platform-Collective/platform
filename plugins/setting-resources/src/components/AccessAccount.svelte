<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import type { Employee } from '@hcengineering/contact'
  import { EmployeePresenter } from '@hcengineering/contact-resources'
  import type { AccountUuid } from '@hcengineering/core'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { Label, tooltip } from '@hcengineering/ui'
  import setting from '../plugin'

  export let account: AccountUuid
  export let employees: Map<AccountUuid, Employee>

  $: employee = employees.get(account)
</script>

{#if employee !== undefined}
  <EmployeePresenter value={employee} disabled showPopup={false} />
{:else}
  <span use:tooltip={{ label: getEmbeddedLabel(account) }}>
    <Label label={setting.string.AccessUnknownUser} />
  </span>
{/if}
