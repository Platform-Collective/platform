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
  import { IdMap, Ref, toIdMap } from '@hcengineering/core'
  import { isOffice, ParticipantInfo, Room, MeetingMinutes } from '@hcengineering/love'
  import { getMetadata } from '@hcengineering/platform'
  import presentation, { getClient } from '@hcengineering/presentation'
  import { closePopup, eventToHTMLElement, location, showPopup, closeTooltip } from '@hcengineering/ui'
  import type { Location } from '@hcengineering/ui'
  import { onDestroy } from 'svelte'
  import workbench from '@hcengineering/workbench'
  import { closeWidget, sidebarStore } from '@hcengineering/workbench-resources'

  import love from '../../plugin'
  import { currentRoom, infos, myInfo, myConnectingSessionId, rooms, meetings } from '../../stores'
  import { createMeetingWidget, getRoomName, liveKitClient } from '../../utils'
  import PersonActionPopup from '../PersonActionPopup.svelte'
  import RoomButton from '../RoomButton.svelte'
  import { lkIsConnecting, lkSessionConnected } from '../../liveKitClient'
  import RoomPopup from '../RoomPopup.svelte'
  import { currentMeeting, leaveMeeting } from '../../meetings'
  import { get } from 'svelte/store'

  const client = getClient()

  interface ActiveRoom extends Room {
    participants: ParticipantInfo[]
    meeting: MeetingMinutes
  }

  function getActiveMeetings(rooms: Room[], infos: ParticipantInfo[], meetings: MeetingMinutes[]): ActiveRoom[] {
    const roomMap = toIdMap(rooms)
    const map: IdMap<ActiveRoom> = new Map()
    for (const info of infos) {
      // Skip explicit reception occupants (they are rendered separately)
      if (info.room === love.ids.Reception) continue

      // Determine the room this participant should be associated with:
      // - If participant is meeting-bound, use the meeting's attached room
      // - Otherwise, use the legacy `room` field
      let attachedRoom = info.room
      let meeting: MeetingMinutes | undefined
      if (info.meeting !== undefined) {
        meeting = meetings.find((m) => m._id === info.meeting)
        if (meeting === undefined) continue
        attachedRoom = meeting.attachedTo as Ref<Room> | undefined
        if (attachedRoom === undefined || attachedRoom === love.ids.Reception) continue
      }

      if (meeting === undefined) continue

      if (attachedRoom === undefined) continue

      const roomObj = roomMap.get(attachedRoom)
      if (roomObj === undefined) continue
      // temporary disabled check for floor
      // if (roomObj.floor !== selectedFloor?._id) continue
      const _id = roomObj._id as Ref<ActiveRoom>
      const active = map.get(_id) ?? { ...roomObj, _id, participants: [], meeting }
      active.participants.push(info)
      map.set(_id, active)
    }
    const arr = Array.from(map.values()).filter(
      (r) => !isOffice(r) || r.participants.length > 1 || r.person !== r.participants[0]?.person
    )
    return arr
  }

  $: activeMeetings = getActiveMeetings($rooms, $infos, $meetings)

  function openRoom(room: ActiveRoom): (e: MouseEvent) => void {
    return (e: MouseEvent) => {
      closeTooltip()
      showPopup(RoomPopup, { room, meeting: room.meeting }, eventToHTMLElement(e))
    }
  }

  const myInvitesCategory = 'myInvites'

  $: reception = $rooms.find((f) => f._id === love.ids.Reception)

  $: receptionParticipants = $infos.filter((p) => p.room === love.ids.Reception)

  function checkActiveMeeting(
    loc: Location,
    meetingSessionConnected: boolean,
    room: Ref<Room> | undefined,
    hasPendingJoinInThisSession: boolean
  ): void {
    const meetingWidgetState = $sidebarStore.widgetsState.get(love.ids.MeetingWidget)
    const isMeetingWidgetCreated = meetingWidgetState !== undefined

    // If user has a pending join in THIS session or is currently connecting, don't make any decisions yet
    // Pending joins from other browser tabs/sessions should not block this session
    if (hasPendingJoinInThisSession || $lkIsConnecting) {
      return
    }

    if (room === undefined) {
      if (isMeetingWidgetCreated) {
        closeWidget(love.ids.MeetingWidget)
      }
      return
    }

    if (meetingSessionConnected) {
      // Only check room mismatch if we have a valid myRoomAttached (myInfo exists with meeting/room)
      // Otherwise we're still waiting for ParticipantInfo from server webhook
      if (currentMeeting !== undefined && myRoomAttached !== undefined && myRoomAttached !== room) {
        void leaveMeeting()
        return
      }
      const widget = client.getModel().findAllSync(workbench.class.Widget, { _id: love.ids.MeetingWidget })[0]
      if (widget === undefined) return

      if (!isMeetingWidgetCreated) {
        createMeetingWidget(widget, room, meetingSessionConnected)
      }
    } else {
      // If user has a ParticipantInfo showing they are in this meeting, keep the widget
      // so they can return after a page reload. Otherwise close the widget.
      if (isMeetingWidgetCreated && myRoomAttached !== room) {
        closeWidget(love.ids.MeetingWidget)
      }
    }
  }

  // Check if pending join is for THIS session (same browser tab)
  $: currentSessionId = getMetadata(presentation.metadata.SessionId)
  $: hasPendingJoinInThisSession = $myConnectingSessionId !== null && $myConnectingSessionId === currentSessionId

  $: checkActiveMeeting($location, $lkSessionConnected, $currentRoom?._id, hasPendingJoinInThisSession)

  let myRoomAttached: Ref<Room> | undefined = undefined
  $: myRoomAttached =
    $myInfo?.meeting !== undefined
      ? ($meetings.find((m) => m._id === $myInfo.meeting)?.attachedTo as Ref<Room>)
      : $myInfo?.room
  $: joined = activeMeetings.filter((r) => myRoomAttached === r._id)

  const beforeUnloadListener = (): void => {
    if ($myInfo !== undefined && $lkSessionConnected) {
      void leaveMeeting()
    }
  }

  window.addEventListener('beforeunload', beforeUnloadListener)

  onDestroy(() => {
    removeEventListener('beforeunload', beforeUnloadListener)
    closePopup(myInvitesCategory)
    closeWidget(love.ids.MeetingWidget)
  })

  function participantClickHandler(e: MouseEvent, participant: ParticipantInfo): void {
    if ($myInfo !== undefined) {
      showPopup(PersonActionPopup, { room: reception, person: participant.person }, eventToHTMLElement(e))
    }
  }

  function getParticipantClickHandler(participant: ParticipantInfo): (e: MouseEvent) => void {
    return (e: MouseEvent) => {
      participantClickHandler(e, participant)
    }
  }

  // beforeUnload listener moved above and cleanup merged into onDestroy
</script>

<div class="flex-row-center flex-gap-2">
  {#if activeMeetings.length > 0}
    <!--    <div class="divider" />-->
    {#each activeMeetings as active}
      {#await getRoomName(active) then name}
        <RoomButton
          label={name}
          participants={active.participants}
          active={joined.find((r) => r._id === active._id) != null}
          on:click={openRoom(active)}
        />
      {/await}
    {/each}
  {/if}
  {#if reception !== undefined && receptionParticipants.length > 0}
    {#if activeMeetings.length > 0}
      <div class="divider" />
    {/if}
    {#await getRoomName(reception) then name}
      <RoomButton
        label={name}
        participants={receptionParticipants.map((p) => ({ ...p, onclick: getParticipantClickHandler(p) }))}
      />
    {/await}
  {/if}
</div>

<style lang="scss">
  .divider {
    height: 1.5rem;
    border: 1px solid var(--theme-divider-color);
  }
</style>
