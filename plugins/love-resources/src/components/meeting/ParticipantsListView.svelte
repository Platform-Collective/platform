<script lang="ts">
  import { aiBotSocialIdentityStore } from '@hcengineering/ai-bot-resources'
  import ParticipantView from './ParticipantView.svelte'
  import { Participant, RemoteParticipant, RoomEvent } from 'livekit-client'
  import { onDestroy, onMount } from 'svelte'
  import { liveKitClient, lk } from '../../utils'
  import { infos, currentMeetingMinutes } from '../../stores'
  import { Ref } from '@hcengineering/core'
  import { Person } from '@hcengineering/contact'
  import { getPersonRefByPersonIdCb } from '@hcengineering/contact-resources'
  import { Room as TypeRoom, MeetingMinutes, ParticipantInfo, Room } from '@hcengineering/love'

  export let room: Ref<TypeRoom>

  interface ParticipantData {
    _id: string
    participant: Participant
    isAgent: boolean
  }

  let aiPersonRef: Ref<Person> | undefined
  $: if ($aiBotSocialIdentityStore != null) {
    getPersonRefByPersonIdCb($aiBotSocialIdentityStore?._id, (ref) => {
      if (ref != null) {
        aiPersonRef = ref
      }
    })
  } else {
    aiPersonRef = undefined
  }

  let participants: ParticipantData[] = []

  onMount(async () => {
    await liveKitClient.awaitConnect()

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

  let lkitParticipants = new Map<Ref<Person>, ParticipantData>()

  // Attach or update a participant entry (using LiveKit identity as key).
  function attachParticipant(participant: Participant): void {
    // Add new participant
    const value: ParticipantData = {
      _id: participant.identity,
      participant,
      isAgent: participant.isAgent
    }
    lkitParticipants.set(participant.identity as Ref<Person>, value)
    lkitParticipants = lkitParticipants
  }

  function handleParticipantDisconnected(participant: RemoteParticipant): void {
    lkitParticipants.delete(participant.identity as Ref<Person>)
    lkitParticipants = lkitParticipants
  }

  function updateParticipants(
    data: ParticipantInfo[],
    currentMeeting: MeetingMinutes | undefined,
    room: Ref<Room>,
    participantData: Map<Ref<Person>, ParticipantData>
  ): void {
    const _participants: ParticipantData[] = []
    for (const info of data.filter((it) => it.meeting === currentMeeting?._id)) {
      const participant = participantData.get(info.person)
      if (participant === undefined) {
        continue
      }
      const value: ParticipantData = {
        _id: info.person,
        participant: participant.participant,
        isAgent: info.person === aiPersonRef
      }
      _participants.push(value)
    }
    participants = _participants
  }

  $: updateParticipants($infos, $currentMeetingMinutes, room, lkitParticipants)
</script>

{#each participants as participant (participant._id)}
  <div class="video">
    <ParticipantView {...participant} />
  </div>
{/each}
