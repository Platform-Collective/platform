<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import type { Employee } from '@hcengineering/contact'
  import core from '@hcengineering/core'
  import type { AccountUuid } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import view from '@hcengineering/view'
  import type { SpaceAccess } from '../access-overview'
  import setting from '../plugin'
  import AccessAccount from './AccessAccount.svelte'

  export let entry: SpaceAccess
  export let employees: Map<AccountUuid, Employee>

  const hierarchy = getClient().getHierarchy()
  let expanded = false
</script>

<details class="space" bind:open={expanded}>
  <summary>
    <strong>{entry.space.name}</strong>
    <span class="type"><Label label={hierarchy.getClass(entry.space._class).label} /></span>
    {#if entry.type !== undefined}<span>{entry.type.name}</span>{/if}
    <span>
      <Label label={core.string.Private} />:
      <Label label={entry.space.private ? setting.string.AccessYes : setting.string.AccessNo} />
    </span>
    <span>
      <Label label={core.string.AutoJoin} />:
      <Label label={entry.space.autoJoin ? setting.string.AccessYes : setting.string.AccessNo} />
    </span>
    <span>
      <Label label={view.string.Archived} />:
      <Label label={entry.space.archived ? setting.string.AccessYes : setting.string.AccessNo} />
    </span>
    <span><Label label={core.string.Members} />: {entry.members.length}</span>
  </summary>
  {#if expanded}
    <div class="details">
      <div class="accounts">
        <strong><Label label={core.string.Owners} /></strong>
        {#each entry.owners as account (account)}
          <AccessAccount {account} {employees} />
        {:else}
          <Label label={setting.string.AccessNone} />
        {/each}
      </div>
      <div class="accounts">
        <strong><Label label={core.string.Members} /></strong>
        {#each entry.members as account (account)}
          <AccessAccount {account} {employees} />
        {:else}
          <Label label={setting.string.AccessNone} />
        {/each}
      </div>
      {#each entry.roles as { role, accounts } (role._id)}
        <div class="accounts">
          <strong>{role.name}</strong>
          {#each accounts as account (account)}
            <AccessAccount {account} {employees} />
          {:else}
            <Label label={setting.string.AccessNone} />
          {/each}
        </div>
      {/each}
    </div>
  {/if}
</details>

<style lang="scss">
  .space {
    padding: 0.75rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }

  summary {
    cursor: pointer;
    line-height: 1.75;

    > span {
      margin-left: 0.75rem;
    }
  }

  .type {
    color: var(--theme-content-color);
  }

  .details {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 0.75rem 0 0 1rem;
  }

  .accounts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }
</style>
