<!--
// Copyright © 2023 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import { onDestroy } from 'svelte'
  import { AccountRole, getCurrentAccount, hasAccountRole, Ref } from '@hcengineering/core'
  import type {
    NotificationType,
    NotificationGroup,
    NotificationPreferencesGroup,
    NotificationTypeSetting,
    WorkspaceNotificationTypeSetting
  } from '@hcengineering/notification'
  import { getResource } from '@hcengineering/platform'
  import { getClient, isDisabled } from '@hcengineering/presentation'
  import {
    Breadcrumb,
    defineSeparators,
    getCurrentResolvedLocation,
    Header,
    Label,
    Loading,
    Location,
    ModernToggle,
    navigate,
    NavItem,
    resolvedLocationStore,
    Scroller,
    Separator,
    twoPanelsSeparators
  } from '@hcengineering/ui'

  import notification from '../../plugin'
  import NotificationGroupSetting from './NotificationGroupSetting.svelte'
  import { providersSettings, typesSettings, workspaceTypesSettings } from '../../utils'

  const client = getClient()
  const groups: NotificationGroup[] = client.getModel().findAllSync(notification.class.NotificationGroup, {})
  const preferencesGroups: NotificationPreferencesGroup[] = client
    .getModel()
    .findAllSync(notification.class.NotificationPreferencesGroup, {})

  let settings = new Map<Ref<NotificationType>, NotificationTypeSetting[]>()
  let workspaceSettings = new Map<Ref<NotificationType>, WorkspaceNotificationTypeSetting[]>()

  // Only workspace owners may edit workspace-wide defaults (enforced on the server as well)
  const isOwner = hasAccountRole(getCurrentAccount(), AccountRole.Owner)
  let workspaceMode = false

  let isProviderSettingLoading = true
  let isTypeSettingLoading = true

  $: loading = isProviderSettingLoading || isTypeSettingLoading

  const unsubscribeTypeSetting = typesSettings.subscribe((res) => {
    settings = new Map()
    for (const value of res) {
      const arr = settings.get(value.type) ?? []
      arr.push(value)
      settings.set(value.type, arr)
    }
    settings = settings
    isTypeSettingLoading = false
  })

  const unsubscribeProviderSetting = providersSettings.subscribe(() => {
    isProviderSettingLoading = false
  })

  const unsubscribeWorkspaceTypeSetting = workspaceTypesSettings.subscribe((res) => {
    const result = new Map<Ref<NotificationType>, WorkspaceNotificationTypeSetting[]>()
    for (const value of res) {
      const arr = result.get(value.type) ?? []
      arr.push(value)
      result.set(value.type, arr)
    }
    workspaceSettings = result
  })

  function selectGroup(gr: Ref<NotificationGroup>): void {
    group = gr
    currentPreferenceGroup = undefined
    const loc = getCurrentResolvedLocation()
    loc.path[4] = group
    loc.path.length = 5
    navigate(loc)
  }

  function toggleWorkspaceMode(): void {
    workspaceMode = !workspaceMode
    // Workspace defaults are only available for the notification types matrix
    if (workspaceMode && group === undefined && groups.length > 0) {
      selectGroup(groups[0]._id)
    }
  }

  let group: Ref<NotificationGroup> | undefined = undefined
  let currentPreferenceGroup: NotificationPreferencesGroup | undefined = undefined

  $: if (!group && !currentPreferenceGroup) {
    if (preferencesGroups.length > 0 && !workspaceMode) {
      currentPreferenceGroup = preferencesGroups[0]
    } else if (groups.length > 0) {
      group = groups[0]._id
    }
  }

  const unsubscribeLocation = resolvedLocationStore.subscribe((loc) => {
    void (async (loc: Location): Promise<void> => {
      group = loc.path[4] as Ref<NotificationGroup>
      currentPreferenceGroup = undefined
    })(loc)
  })

  onDestroy(() => {
    unsubscribeLocation()
    unsubscribeTypeSetting()
    unsubscribeProviderSetting()
    unsubscribeWorkspaceTypeSetting()
  })
  defineSeparators('notificationSettings', twoPanelsSeparators)
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb
      icon={notification.icon.Notifications}
      label={notification.string.Notifications}
      size={'large'}
      isCurrent
    />
    <svelte:fragment slot="actions">
      {#if isOwner}
        <ModernToggle
          size="small"
          label={notification.string.WorkspaceDefaults}
          checked={workspaceMode}
          on:change={toggleWorkspaceMode}
        />
      {/if}
    </svelte:fragment>
  </Header>
  <div class="hulyComponent-content__container columns">
    <div class="hulyComponent-content__column navigation py-2">
      <Scroller shrink>
        {#each workspaceMode ? [] : preferencesGroups as preferenceGroup}
          <NavItem
            icon={preferenceGroup.icon}
            label={preferenceGroup.label}
            selected={preferenceGroup === currentPreferenceGroup}
            on:click={() => {
              currentPreferenceGroup = preferenceGroup
              group = undefined
              const loc = getCurrentResolvedLocation()
              loc.path.length = 4
              navigate(loc)
            }}
          />
        {/each}
        {#if !workspaceMode && preferencesGroups.length > 0 && groups.length > 0}
          <div class="antiNav-divider line" />
        {/if}
        {#each groups as gr}
          {#if !isDisabled(gr._id)}
            <NavItem
              icon={gr.icon}
              label={gr.label}
              selected={gr._id === group}
              on:click={() => {
                selectGroup(gr._id)
              }}
            />
          {/if}
        {/each}
        <div class="antiNav-space" />
      </Scroller>
    </div>
    <Separator name="notificationSettings" index={0} color={'var(--theme-divider-color)'} />
    <div class="hulyComponent-content__column content">
      <Scroller align={'center'} padding={'var(--spacing-3)'} bottomPadding={'var(--spacing-3)'}>
        <div class="hulyComponent-content">
          {#if loading}
            <Loading />
          {:else}
            {#if workspaceMode}
              <div class="mb-4">
                <Label label={notification.string.WorkspaceDefaultsDescription} />
              </div>
            {/if}
            {#if group}
              <NotificationGroupSetting {group} {settings} {workspaceSettings} {workspaceMode} />
            {/if}
            {#if currentPreferenceGroup && !workspaceMode}
              {#await getResource(currentPreferenceGroup.presenter) then presenter}
                <svelte:component this={presenter} />
              {/await}
            {/if}
          {/if}
        </div>
      </Scroller>
    </div>
  </div>
</div>
