<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import type { Employee } from '@hcengineering/contact'
  import { EmployeePresenter } from '@hcengineering/contact-resources'
  import type { AccountUuid } from '@hcengineering/core'

  export let account: AccountUuid
  export let employees: Map<AccountUuid, Employee>

  $: employee = employees.get(account)
</script>

{#if employee !== undefined}
  <EmployeePresenter value={employee} disabled showPopup={false} />
{:else}
  <span>{account}</span>
{/if}
