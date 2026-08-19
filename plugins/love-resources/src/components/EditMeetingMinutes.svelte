<!--
// Copyright © 2024 Hardcore Engineering Inc.
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
  import presentation, { getClient } from '@hcengineering/presentation'
  import { EditBox, ModernButton } from '@hcengineering/ui'
  import { MeetingMinutes, MeetingStatus, ParticipantInfo, Room } from '@hcengineering/love'
  import { createEventDispatcher, onMount } from 'svelte'

  import love from '../plugin'
  import { joinMeeting, leaveMeeting } from '../meetings'
  import { currentMeetingMinutes, currentRoom, infos, myConnectingSessionId, rooms } from '../stores'
  import { lkIsConnecting, lkSessionConnected } from '../liveKitClient'
  import { getMetadata } from '@hcengineering/platform'
  import { Ref } from '@hcengineering/core'
  import RoomPreview from './RoomPreview.svelte'
  import ParticipantsPreview from './ParticipantsPreview.svelte'
  import { openWidgetTab } from '@hcengineering/workbench-resources'
  import { videoVisible } from '../utils'

  export let object: MeetingMinutes
  export let readonly: boolean = false

  const client = getClient()
  const dispatch = createEventDispatcher()

  let currentTitle = object.title
  let newTitle = object.title

  $: if (object.title !== currentTitle) {
    newTitle = object.title
    currentTitle = object.title
  }

  async function changeTitle(): Promise<void> {
    await client.diffUpdate(object, { title: newTitle })
  }

  onMount(() => {
    dispatch('open', { ignoreKeys: ['title'] })
  })

  // Check if pending join is for THIS session (same browser tab)
  $: currentSessionId = getMetadata(presentation.metadata.SessionId)
  $: hasPendingJoinInThisSession =
    $myConnectingSessionId !== null && $myConnectingSessionId === currentSessionId && $lkIsConnecting

  async function connect(): Promise<void> {
    await joinMeeting(object)
  }

  $: connectLabel = object.status !== MeetingStatus.Scheduled ? love.string.JoinMeeting : love.string.StartMeeting

  function showConnectionButton(object: MeetingMinutes, connecting: boolean, isConnected: boolean): boolean {
    if (object.status === MeetingStatus.Finished) {
      return false
    }
    // Show during connecting with spinner
    if (connecting) return true
    // Do not show connect button if we are already connected to the room
    if (isConnected && $currentMeetingMinutes?._id === object._id) return false

    return true
  }

  function getInfo(mm: Ref<MeetingMinutes>, info: ParticipantInfo[]): ParticipantInfo[] {
    return info.filter((p) => p.meeting === mm)
  }

  $: roomInfos = getInfo(object._id, $infos)

  $: room = $rooms.find((it) => it._id === object.attachedTo)
</script>

<div class="flex flex-col">
  <div class="flex flex-row">
    <div class="flex flex-grow flex-between gap-2 mb-4">
      <div class="title flex-grow">
        <EditBox
          disabled={readonly}
          placeholder={love.string.MeetingMinutes}
          bind:value={newTitle}
          on:change={changeTitle}
          focusIndex={1}
        />
      </div>
      {#if showConnectionButton(object, hasPendingJoinInThisSession, $lkSessionConnected)}
        <ModernButton
          label={connectLabel}
          size="large"
          kind={'primary'}
          on:click={connect}
          loading={hasPendingJoinInThisSession}
        />
      {:else if $lkSessionConnected}
        {#if !$videoVisible}
          <ModernButton
            label={love.string.ShowVideo}
            size="large"
            kind={'secondary'}
            on:click={() => {
              openWidgetTab(love.ids.MeetingWidget, 'video')
            }}
          />
        {/if}
        <ModernButton
          label={love.string.LeaveRoom}
          size="large"
          kind={'negative'}
          on:click={() => {
            void leaveMeeting()
          }}
        />
      {/if}
    </div>
  </div>
  {#if object != null && roomInfos.length > 0 && room != null}
    <div class="room-preview">
      <ParticipantsPreview info={roomInfos} />
    </div>
  {/if}
</div>

<style lang="scss">
  .title {
    font-weight: 500;
    font-size: 1.25rem;
    color: var(--theme-caption-color);
  }
  .room-preview {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }
</style>
