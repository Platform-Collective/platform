<!-- SPDX-License-Identifier: EPL-2.0 -->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import chunter from '@hcengineering/chunter'
  import contact, { formatName } from '@hcengineering/contact'
  import type { Employee } from '@hcengineering/contact'
  import core, { AccountRole } from '@hcengineering/core'
  import type { AccountUuid, Class, Ref, Role, Space, SpaceType, WorkspaceMemberInfo } from '@hcengineering/core'
  import type { IntlString } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import {
    Breadcrumb,
    DropdownLabelsIntl,
    Header,
    Label,
    Loading,
    ModernToggle,
    Scroller,
    SearchInput
  } from '@hcengineering/ui'
  import view from '@hcengineering/view'
  import { onDestroy, onMount } from 'svelte'
  import { collectPersonAccess, collectSpaceAccess, filterSpaceAccess } from '../access-overview'
  import setting from '../plugin'
  import { getAccountClient } from '../utils'
  import AccessAccount from './AccessAccount.svelte'
  import AccessCollapse from './AccessCollapse.svelte'
  import AccessSpace from './AccessSpace.svelte'

  const hierarchy = getClient().getHierarchy()
  const spacesQuery = createQuery()
  const typesQuery = createQuery()
  const rolesQuery = createQuery()
  const employeesQuery = createQuery()
  const excludedClasses = [core.class.SystemSpace, contact.class.PersonSpace, chunter.class.DirectMessage]
  const roleLabels: Record<AccountRole, IntlString> = {
    [AccountRole.Owner]: setting.string.Owner,
    [AccountRole.Maintainer]: setting.string.Maintainer,
    [AccountRole.User]: setting.string.User,
    [AccountRole.Guest]: setting.string.Guest,
    [AccountRole.ReadOnlyGuest]: setting.string.AccessReadonlyGuest,
    [AccountRole.DocGuest]: setting.string.AccessDocumentGuest,
    [AccountRole.Admin]: setting.string.AccessAdmin
  }

  let spaces: Space[] = []
  let types: SpaceType[] = []
  let roles: Role[] = []
  let employees = new Map<AccountUuid, Employee>()
  let members: WorkspaceMemberInfo[] = []
  let membersLoaded = false
  let spacesLoaded = false
  let typesLoaded = false
  let rolesLoaded = false
  let employeesLoaded = false
  let failed = false
  let search = ''
  let appliedSearch = ''
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  $: {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      appliedSearch = search
    }, 200)
  }
  onDestroy(() => {
    clearTimeout(searchTimer)
  })
  let mode = 'spaces'
  let spaceClass = 'all'
  let privacy = 'all'
  let archived = 'all'
  let guestsOnly = false
  let expandedPeople: Record<AccountUuid, boolean> = {}

  onMount(() => {
    spacesQuery.query(
      core.class.Space,
      {},
      (result) => {
        spaces = result
        spacesLoaded = true
      },
      { showArchived: true }
    )
    typesQuery.query(core.class.SpaceType, {}, (result) => {
      types = result
      typesLoaded = true
    })
    rolesQuery.query(core.class.Role, {}, (result) => {
      roles = result
      rolesLoaded = true
    })
    employeesQuery.query(contact.mixin.Employee, {}, (result) => {
      employees = new Map(
        result.flatMap((employee) => (employee.personUuid == null ? [] : [[employee.personUuid, employee] as const]))
      )
      employeesLoaded = true
    })
    void loadMembers()
  })

  async function loadMembers(): Promise<void> {
    try {
      members = await getAccountClient().getWorkspaceMembers()
      membersLoaded = true
    } catch (error) {
      failed = true
      Analytics.handleError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  function personName(person: AccountUuid, employeesByAccount: Map<AccountUuid, Employee>): string {
    const employee = employeesByAccount.get(person)
    return employee === undefined ? person : formatName(employee.name) || person
  }

  $: inventory = collectSpaceAccess(spaces, types, roles, hierarchy, excludedClasses)
  $: classes = [...new Set(inventory.map(({ space }) => space._class))]
  $: filteredSpaces = filterSpaceAccess(inventory, {
    search: mode === 'spaces' ? appliedSearch : '',
    spaceClass: spaceClass === 'all' ? undefined : (spaceClass as Ref<Class<Space>>),
    private: privacy === 'all' ? undefined : privacy === 'private',
    archived: archived === 'all' ? undefined : archived === 'archived'
  })
  $: personAccess = collectPersonAccess(filteredSpaces, members)
  $: people = personAccess
    .filter(
      (person) =>
        (!guestsOnly || person.guest) &&
        `${personName(person.person, employees)} ${person.person}`
          .toLocaleLowerCase()
          .includes(appliedSearch.trim().toLocaleLowerCase())
    )
    .sort((a, b) => personName(a.person, employees).localeCompare(personName(b.person, employees)))
  $: loaded = membersLoaded && spacesLoaded && typesLoaded && rolesLoaded && employeesLoaded
</script>

<div class="hulyComponent">
  <Header adaptive="disabled">
    <Breadcrumb icon={setting.icon.Members} label={setting.string.AccessOverview} size="large" isCurrent />
    <svelte:fragment slot="search">
      <SearchInput bind:value={search} collapsed />
    </svelte:fragment>
  </Header>
  <div class="hulyComponent-content__column">
    <Scroller padding="var(--spacing-3)" bottomPadding="var(--spacing-3)">
      <div class="overview">
        <p><Label label={setting.string.AccessOverviewHint} /></p>
        {#if failed}
          <p role="alert"><Label label={setting.string.AccessLoadError} /></p>
        {:else if !loaded}
          <Loading />
        {:else}
          <div class="filters">
            <div class="filter">
              <Label label={setting.string.AccessView} />
              <DropdownLabelsIntl
                items={[
                  { id: 'spaces', label: setting.string.Spaces },
                  { id: 'people', label: setting.string.AccessPeople }
                ]}
                bind:selected={mode}
              />
            </div>
            <div class="filter">
              <Label label={setting.string.Type} />
              <DropdownLabelsIntl
                items={[
                  { id: 'all', label: setting.string.AccessAll },
                  ...classes.map((id) => ({ id, label: hierarchy.getClass(id).label }))
                ]}
                bind:selected={spaceClass}
              />
            </div>
            <div class="filter">
              <Label label={core.string.Private} />
              <DropdownLabelsIntl
                items={[
                  { id: 'all', label: setting.string.AccessAll },
                  { id: 'private', label: core.string.Private },
                  { id: 'public', label: setting.string.AccessPublic }
                ]}
                bind:selected={privacy}
              />
            </div>
            <div class="filter">
              <Label label={view.string.Archived} />
              <DropdownLabelsIntl
                items={[
                  { id: 'all', label: setting.string.AccessAll },
                  { id: 'archived', label: view.string.Archived },
                  { id: 'active', label: setting.string.AccessActive }
                ]}
                bind:selected={archived}
              />
            </div>
            {#if mode === 'people'}
              <ModernToggle label={setting.string.AccessGuestsOnly} bind:checked={guestsOnly} />
            {/if}
          </div>
          {#if mode === 'spaces'}
            {#each filteredSpaces as entry (entry.space._id)}
              <AccessSpace {entry} {employees} />
            {:else}
              <Label label={setting.string.AccessNoResults} />
            {/each}
          {:else}
            {#each people as person (person.person)}
              <div class="person">
                <div class="summary">
                  <AccessCollapse
                    expanded={expandedPeople[person.person] ?? false}
                    label={personName(person.person, employees)}
                    on:click={() => {
                      expandedPeople[person.person] = !expandedPeople[person.person]
                    }}
                  />
                  <AccessAccount account={person.person} {employees} />
                  <span><Label label={roleLabels[person.role]} /></span>
                  <span><Label label={setting.string.Spaces} />: {person.spaces.length}</span>
                </div>
                {#if expandedPeople[person.person]}
                  {#each person.spaces as membership (membership.entry.space._id)}
                    <div class="membership">
                      {#if membership.owner}<Label label={setting.string.Owner} />{/if}
                      {#if membership.member}<Label label={setting.string.AccessMember} />{/if}
                      {#each membership.roles as role}<span>{role.name}</span>{/each}
                      <AccessSpace entry={membership.entry} {employees} />
                    </div>
                  {:else}
                    <p><Label label={setting.string.AccessNoSpaces} /></p>
                  {/each}
                {/if}
              </div>
            {:else}
              <Label label={setting.string.AccessNoResults} />
            {/each}
          {/if}
        {/if}
      </div>
    </Scroller>
  </div>
</div>

<style lang="scss">
  .overview {
    width: 100%;
    padding: 1rem;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
    margin: 1rem 0;

    .filter {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
  }

  .person {
    padding: 0.75rem;
    border-bottom: 1px solid var(--theme-divider-color);

    .summary {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      line-height: 2;

      > span {
        margin-left: 0.75rem;
      }
    }
  }

  .membership {
    margin: 0.75rem 0 0 1rem;

    > span {
      margin-left: 0.5rem;
    }
  }
</style>
