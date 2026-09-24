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
  // GuestParticipantView.svelte
  // Guest-specific participant view that relies ONLY on LiveKit Participant data.
  // Does not query contact caches or person lookups. Falls back to participant.name / identity.

  import { onDestroy, onMount } from 'svelte'
  import { Avatar } from '@hcengineering/contact-resources'
  import { Loading } from '@hcengineering/ui'
  import MicDisabled from '../icons/MicDisabled.svelte'
  import BadConnection from '../icons/BadConnection.svelte'
  import Reaction from '../meeting/Reaction.svelte'

  import { ConnectionQuality, ParticipantEvent, RoomEvent, Track } from 'livekit-client'

  import type {
    ChatMessage,
    LocalParticipant,
    LocalTrackPublication,
    Participant,
    RemoteParticipant,
    RemoteTrack,
    RemoteTrackPublication,
    TrackPublication
  } from 'livekit-client'

  import { lk, liveKitClient } from '../../utils'
  import { formatName } from '@hcengineering/contact'

  export let _id: string
  export let participant: Participant | undefined = undefined
  export let isAgent: boolean = false

  let parent: HTMLDivElement | undefined
  let mirror: boolean = false

  let activeParticipant: Participant | undefined = undefined
  let videoTrack: Track | undefined = undefined
  let videoTrackElement: HTMLMediaElement | undefined = undefined
  let videoMuted = true
  let microphoneMuted = true
  let isSpeaking = false
  let isBadConnection = false

  // A local list of reactions (emojis) to display on this participant tile
  let reactions: Array<{ id: string, emoji: string, width: number, height: number }> = []

  // Attach a track's element to the DOM
  function attachTrack (track: Track): void {
    if (parent == null) return
    detachCurrentTrack()

    videoTrack = track
    videoTrackElement = track.attach()
    videoTrackElement.classList.add('video')
    parent.appendChild(videoTrackElement)

    // When a track element is attached, show it by default.
    // Actual visibility (muted/unmuted) will be applied by `setTrackMuted` based on publication state.
    videoMuted = false
  }

  function detachCurrentTrack (): void {
    if (videoTrackElement !== undefined) {
      try {
        videoTrack?.detach(videoTrackElement)
      } catch {
        // ignore
      }
      try {
        videoTrackElement.remove()
      } catch {
        // ignore
      }
      videoTrackElement = undefined
      videoTrack = undefined
    }
  }

  function setTrackMuted (value: boolean): void {
    if (videoTrackElement !== undefined) {
      if (value) {
        videoTrackElement.classList.add('hidden')
      } else {
        videoTrackElement.classList.remove('hidden')
      }
    }
    videoMuted = value
  }

  function speachHandler (speaking: boolean): void {
    isSpeaking = speaking
  }

  function muteHandler (publication: TrackPublication): void {
    if (publication.kind === Track.Kind.Audio) {
      microphoneMuted = publication.isMuted
    } else if (publication.kind === Track.Kind.Video && publication.source !== Track.Source.ScreenShare) {
      setTrackMuted(publication.isMuted)
    }
  }

  function onConnectionQualityChanged (quality: ConnectionQuality): void {
    isBadConnection = quality === ConnectionQuality.Lost || quality === ConnectionQuality.Poor
  }

  function onLocalTrackPublished (publication: LocalTrackPublication): void {
    if (publication.track === undefined) return
    if (publication.kind === Track.Kind.Audio) {
      microphoneMuted = publication.isMuted
    } else if (publication.kind === Track.Kind.Video && publication.source !== Track.Source.ScreenShare) {
      attachTrack(publication.track)
      // Ensure initial visibility follows publication mute state
      setTrackMuted(publication.isMuted)
    }
  }

  function onLocalTrackUnpublished (publication: LocalTrackPublication): void {
    if (videoTrack === publication.track) {
      detachCurrentTrack()
    }
  }

  function onTrackSubscribed (track: RemoteTrack, publication: RemoteTrackPublication): void {
    if (track.kind === Track.Kind.Audio) {
      microphoneMuted = track.isMuted
    } else if (track.kind === Track.Kind.Video && publication.source !== Track.Source.ScreenShare) {
      attachTrack(track)
      // Ensure initial visibility follows publication mute state
      setTrackMuted(publication.isMuted)
    }
  }

  function onTrackUnsubscribed (track: RemoteTrack): void {
    if (videoTrack === track) {
      detachCurrentTrack()
    }
  }

  function onChatMessage (message: ChatMessage, p?: RemoteParticipant | LocalParticipant | undefined): void {
    // Only display reaction if it belongs to this participant
    if (activeParticipant !== p) return
    if (parent == null) return
    reactions = [
      ...reactions,
      {
        id: message.id,
        emoji: message.message,
        width: parent.offsetWidth,
        height: parent.offsetHeight
      }
    ]
  }

  function detachParticipant (): void {
    if (activeParticipant === undefined) return
    activeParticipant.off(ParticipantEvent.TrackMuted, muteHandler)
    activeParticipant.off(ParticipantEvent.TrackUnmuted, muteHandler)
    activeParticipant.off(ParticipantEvent.IsSpeakingChanged, speachHandler)
    activeParticipant.off(ParticipantEvent.ConnectionQualityChanged, onConnectionQualityChanged)

    if (activeParticipant.isLocal) {
      activeParticipant.off(ParticipantEvent.LocalTrackPublished, onLocalTrackPublished)
      activeParticipant.off(ParticipantEvent.LocalTrackUnpublished, onLocalTrackUnpublished)
    } else {
      activeParticipant.off(ParticipantEvent.TrackSubscribed, onTrackSubscribed)
      activeParticipant.off(ParticipantEvent.TrackUnsubscribed, onTrackUnsubscribed)
    }
    activeParticipant = undefined
    detachCurrentTrack()
  }

  function setParticipant (p: Participant | undefined): void {
    if (parent == null) return
    if (activeParticipant === p) return

    detachParticipant()

    activeParticipant = p
    if (p === undefined) return

    // Attach first available camera track
    for (const publication of p.trackPublications.values()) {
      if (
        publication.track !== undefined &&
        publication.kind === Track.Kind.Video &&
        publication.source !== Track.Source.ScreenShare
      ) {
        attachTrack(publication.track)
        break
      }
    }

    mirror = p.isLocal
    microphoneMuted = !p.isMicrophoneEnabled

    p.on(ParticipantEvent.TrackMuted, muteHandler)
    p.on(ParticipantEvent.TrackUnmuted, muteHandler)
    p.on(ParticipantEvent.IsSpeakingChanged, speachHandler)
    p.on(ParticipantEvent.ConnectionQualityChanged, onConnectionQualityChanged)

    if (p.isLocal) {
      p.on(ParticipantEvent.LocalTrackPublished, onLocalTrackPublished)
      p.on(ParticipantEvent.LocalTrackUnpublished, onLocalTrackUnpublished)
    } else {
      p.on(ParticipantEvent.TrackSubscribed, onTrackSubscribed)
      p.on(ParticipantEvent.TrackUnsubscribed, onTrackUnsubscribed)
    }
  }

  // Keep component in sync with participant prop
  $: setParticipant(participant)

  onMount(async () => {
    try {
      await liveKitClient.awaitConnect()
    } catch {
      // ignore
    }
    lk.on(RoomEvent.ChatMessage, onChatMessage)
    setParticipant(participant)
  })

  onDestroy(() => {
    lk.off(RoomEvent.ChatMessage, onChatMessage)
    detachParticipant()
  })

  $: userName = participant?.name ?? participant?.identity ?? ''
</script>

<div id={_id} class="parent" class:speach={isSpeaking}>
  <div bind:this={parent} class="cover" class:active={!videoMuted} class:mirror={mirror && !videoMuted} />
  <div class="ava">
    <!-- Avatar uses only name (no person lookup) -->
    <Avatar size={'full'} name={userName} showStatus={false} />
  </div>
  <div class="label" class:withIcon={microphoneMuted || isBadConnection || participant === undefined}>
    {#if participant === undefined}
      <Loading size={'small'} shrink />
    {/if}
    {#if isBadConnection}
      <BadConnection fill={'var(--bg-negative-default)'} size={'small'} />
    {/if}
    {#if microphoneMuted}
      <MicDisabled fill={'var(--bg-negative-default)'} size={'small'} />
    {/if}
    <span class="overflow-label">{formatName(userName)}</span>
  </div>

  {#each reactions as reaction (reaction.id)}
    <Reaction
      {...reaction}
      on:complete={() => {
        reactions = reactions.filter((it) => it !== reaction)
      }}
    />
  {/each}
</div>

<style lang="scss">
  :global(.video) {
    object-fit: cover;
    border-radius: 0.75rem;
    width: 100%;
  }
  :global(.hidden) {
    display: none;
  }
  .cover {
    overflow: hidden;
    object-fit: cover;
    border-radius: 0.75rem;
    height: 100%;
    width: 100%;
    aspect-ratio: 1280 / 720;
    display: flex;
    justify-content: center;
    align-items: center;

    &.mirror {
      transform: scaleX(-1);
    }

    &.active + .ava {
      display: none;
    }
    &:not(.active) {
      background-color: black;
    }
  }

  .ava {
    overflow: hidden;
    position: absolute;
    top: 50%;
    left: 50%;
    height: 50%;
    aspect-ratio: 1;
    border-radius: 50%;
    transform: translate(-50%, -50%);
  }

  .parent {
    position: relative;
    flex-shrink: 0;
    height: max-content;
    min-height: 0;
    max-height: 100%;
    background-color: black;
    border-radius: 0.75rem;

    &.speach {
      box-shadow: 0 0 0 4px rgba(82, 190, 128, 0.12);
    }

    .label {
      overflow: hidden;
      text-overflow: ellipsis;
      position: absolute;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 0.25rem;
      padding: 0.25rem 0.5rem;
      top: 0.25rem;
      left: 0.25rem;
      max-width: 12rem;
      font-weight: 500;
      font-size: 0.75rem;
      color: white;
      background: rgba(0, 0, 0, 0.45);
      border-radius: 0.375rem;
      .overflow-label {
        max-width: 10rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }
  }
</style>
