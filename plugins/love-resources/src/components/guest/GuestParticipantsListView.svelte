<!--
// Copyright © 2026 Intabia Fusion.
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
  // GuestParticipantsListView.svelte
  // Guest-specific participants list that relies ONLY on LiveKit data.
  // It intentionally avoids any contact cache lookups (personByRefStore),
  // because guests don't have access to contact caches and receive participant
  // metadata only from LiveKit.

  import GuestParticipantView from './GuestParticipantView.svelte'
  import { Participant, RemoteParticipant, RoomEvent } from 'livekit-client'
  import { createEventDispatcher, onDestroy, onMount } from 'svelte'
  import { liveKitClient, lk } from '../../utils'
  import { Ref } from '@hcengineering/core'
  import { Room as TypeRoom } from '@hcengineering/love'

  export let room: Ref<TypeRoom> | undefined = undefined

  const dispatch = createEventDispatcher()

  interface ParticipantData {
    _id: string
    participant: Participant | undefined
    isAgent: boolean
  }

  let participants: ParticipantData[] = []

  // Attach or update a participant entry (using LiveKit identity as key).
  function attachParticipant(participant: Participant): void {
    if (participant == null) return
    if (participant.identity == null || participant.identity === '') return

    const current = participants.find((p) => p._id === participant.identity)
    if (current !== undefined) {
      current.participant = participant
      participants = participants
      return
    }

    // Add new participant
    const value: ParticipantData = {
      _id: participant.identity,
      participant,
      isAgent: participant.isAgent
    }
    participants.push(value)
    participants = participants
  }

  function handleParticipantDisconnected(participant: RemoteParticipant): void {
    const index = participants.findIndex((p) => p._id === participant.identity)
    if (index !== -1) {
      participants.splice(index, 1)
      participants = participants
    }
  }

  // Initialize local view from LiveKit and subscribe to room events.
  onMount(async () => {
    // wait until LiveKit client is connected
    try {
      await liveKitClient.awaitConnect()
    } catch {
      // connection couldn't be established - we still set up listeners
    }

    // Populate initial participants from current LiveKit room state
    for (const participant of lk.remoteParticipants.values()) {
      attachParticipant(participant)
    }

    // Include local participant (if available)
    attachParticipant(lk.localParticipant)

    // Subscribe to LiveKit participant lifecycle events
    lk.on(RoomEvent.ParticipantConnected, attachParticipant)
    lk.on(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
  })

  onDestroy(() => {
    lk.off(RoomEvent.ParticipantConnected, attachParticipant)
    lk.off(RoomEvent.ParticipantDisconnected, handleParticipantDisconnected)
  })

  // Return active participants to render. For guests we hide agent participants
  // unless there's an explicit reason to show them (guests don't have DB-based info).
  function getActiveParticipants(items: ParticipantData[]): ParticipantData[] {
    const result = items.filter((p) => !p.isAgent)
    dispatch('participantsCount', result.length)
    return result
  }

  $: activeParticipants = getActiveParticipants(participants)
</script>

{#each activeParticipants as participant (participant._id)}
  <div class="video">
    <GuestParticipantView {...participant} />
  </div>
{/each}
