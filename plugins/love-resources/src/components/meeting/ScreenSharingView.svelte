<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { liveKitClient, lk } from '../../utils'
  import {
    LocalParticipant,
    LocalTrackPublication,
    RemoteParticipant,
    RemoteTrack,
    RemoteTrackPublication,
    RoomEvent,
    Track
  } from 'livekit-client'
  import { IconScale, IconScaleFull, ButtonIcon } from '@hcengineering/ui'

  export let hasActiveTrack: boolean = false
  export let showLocalTrack: boolean = true

  let activeTrack: Track | null = null
  let screen: HTMLVideoElement

  let scale = 1
  const MIN_SCALE = 1
  const MAX_SCALE = 3
  const SCALE_STEP = 0.25
  const WHEEL_SCALE_STEP = 0.1

  let panX = 0
  let panY = 0
  let isDragging = false
  let startX = 0
  let startY = 0

  let container: HTMLDivElement

  let showControls = false
  let hideTimeout: ReturnType<typeof setTimeout> | undefined

  function showControlsWithTimeout (): void {
    showControls = true
    clearTimeout(hideTimeout)
    hideTimeout = setTimeout(() => {
      showControls = false
    }, 2000)
  }

  function handleMouseEnter (): void {
    showControlsWithTimeout()
  }

  function handleMouseLeave (): void {
    showControls = false
    clearTimeout(hideTimeout)
  }

  function zoomIn (): void {
    scale = Math.min(MAX_SCALE, scale + SCALE_STEP)
    clampPan()
  }

  function zoomOut (): void {
    scale = Math.max(MIN_SCALE, scale - SCALE_STEP)
    clampPan()
  }

  function clampPan (): void {
    if (scale <= 1) {
      panX = 0
      panY = 0
    }
  }

  function resetZoom (): void {
    scale = 1
    panX = 0
    panY = 0
  }

  function handleMouseDown (e: MouseEvent): void {
    if (scale > 1) {
      isDragging = true
      startX = e.clientX - panX
      startY = e.clientY - panY
    }
  }

  function handleMouseMove (e: MouseEvent): void {
    if (isDragging && scale > 1) {
      panX = e.clientX - startX
      panY = e.clientY - startY
      clampPan()
    }
    showControlsWithTimeout()
  }

  function handleMouseUp (): void {
    isDragging = false
    clampPan()
  }

  function handleWheel (e: WheelEvent): void {
    e.preventDefault()
    const rect = container.getBoundingClientRect()
    const mouseX = e.clientX - rect.left - rect.width / 2
    const mouseY = e.clientY - rect.top - rect.height / 2

    const delta = e.deltaY < 0 ? WHEEL_SCALE_STEP : -WHEEL_SCALE_STEP
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale + delta))
    if (newScale !== scale) {
      panX += (mouseX - panX) * (1 - newScale / scale)
      panY += (mouseY - panY) * (1 - newScale / scale)
      scale = newScale
      clampPan()
    }
  }

  function trySetActiveTrack (track: Track | undefined): boolean {
    if (track === undefined) return false
    if (track.kind !== Track.Kind.Video || track.source !== Track.Source.ScreenShare) return false
    hasActiveTrack = true
    activeTrack = track
    track.attach(screen)
    return true
  }

  function clearActiveTrack (track: Track | undefined): void {
    if (track !== activeTrack) return
    hasActiveTrack = false
    activeTrack?.detach()
    activeTrack = null
  }

  function onTrackSubscribed (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ): void {
    trySetActiveTrack(track)
  }

  function onTrackUnsubscribed (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ): void {
    clearActiveTrack(track)
  }

  function onLocalTrackPublished (publication: LocalTrackPublication, participant: LocalParticipant): void {
    trySetActiveTrack(publication.track)
  }

  function onLocalTrackUnpublished (publication: LocalTrackPublication, participant: LocalParticipant): void {
    clearActiveTrack(publication.track)
  }

  onMount(async () => {
    await liveKitClient.awaitConnect()

    lk.on(RoomEvent.TrackSubscribed, onTrackSubscribed)
    lk.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
    for (const participant of lk.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (trySetActiveTrack(publication.track)) break
      }
    }

    if (showLocalTrack) {
      lk.on(RoomEvent.LocalTrackPublished, onLocalTrackPublished)
      lk.on(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished)
      for (const publication of lk.localParticipant.trackPublications.values()) {
        if (trySetActiveTrack(publication.track)) break
      }
    }
  })

  onDestroy(() => {
    activeTrack?.detach(screen)
    lk.off(RoomEvent.TrackSubscribed, onTrackSubscribed)
    lk.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
    if (showLocalTrack) {
      lk.off(RoomEvent.LocalTrackPublished, onLocalTrackPublished)
      lk.off(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished)
    }
  })
</script>

<div
  class="video-wrapper"
  bind:this={container}
  on:wheel={handleWheel}
  on:mouseenter={handleMouseEnter}
  on:mouseleave={handleMouseLeave}
>
  <video
    class="screen"
    bind:this={screen}
    style={`transform: scale(${scale}) translate(${panX / scale}px, ${panY / scale}px);`}
    on:mousedown={handleMouseDown}
    on:mousemove={handleMouseMove}
    on:mouseup={handleMouseUp}
    on:mouseleave={handleMouseUp}
  />
  {#if hasActiveTrack}
    <div class="zoom-controls" class:visible={showControls}>
      <ButtonIcon icon={IconScale} size="small" on:click={zoomOut} disabled={scale <= MIN_SCALE} />
      <span class="zoom-level">{Math.round(scale * 100)}%</span>
      <ButtonIcon icon={IconScale} size="small" on:click={zoomIn} disabled={scale >= MAX_SCALE} />
      <ButtonIcon icon={IconScaleFull} size="small" on:click={resetZoom} disabled={scale === 1} />
    </div>
  {/if}
</div>

<style lang="scss">
  .video-wrapper {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: 0.75rem;
  }

  .screen {
    object-fit: contain;
    max-width: 100%;
    max-height: 100%;
    height: 100%;
    width: 100%;
    border-radius: 0.75rem;
    cursor: grab;
    transform-origin: center center;
    transition: transform 0.1s ease-out;
  }

  .screen:active {
    cursor: grabbing;
  }

  .zoom-controls {
    position: absolute;
    bottom: 0.5rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    background: var(--accent-color-primary);
    color: var(--button-subtle-LabelColor);
    border-radius: 0.5rem;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .zoom-controls.visible {
    opacity: 1;
  }

  .zoom-level {
    min-width: 3rem;
    text-align: center;
    font-size: 0.75rem;
    color: #fff;
  }
</style>
