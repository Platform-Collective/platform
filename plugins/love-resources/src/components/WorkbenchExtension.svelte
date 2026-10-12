<script lang="ts">
  import { isSafari, pushRootBarComponent } from '@hcengineering/ui'
  import {
    Participant,
    RemoteParticipant,
    RemoteTrack,
    RemoteTrackPublication,
    RoomEvent,
    Track,
    TrackPublication
  } from 'livekit-client'
  import { onDestroy, onMount } from 'svelte'
  import { subscribeToIncomingInvites, unsubscribeFromIncomingInvites } from '../invites'
  import { lkIsConnecting, lkReconnected, lkSessionConnected } from '../liveKitClient'
  import love from '../plugin'
  import { myConnectingSessionId } from '../stores'
  import { liveKitClient, lk } from '../utils'
  import { get } from 'svelte/store'

  let parentElement: HTMLDivElement
  let audioUnlocked = false
  let safariAudioCheckInterval: ReturnType<typeof setInterval> | undefined

  const isSafariBrowser = typeof navigator !== 'undefined' && isSafari()

  interface AudioContextState {
    state: string
    sampleRate?: number
    currentTime?: number
    error?: string
  }

  interface AudioTrackDiagnostics {
    trackSid: string
    participantId: string
    participantName: string
    isMuted: boolean
    mediaTrackReadyState: string
    mediaTrackEnabled: boolean
    mediaTrackMuted: boolean
    elementExists: boolean
    elementPaused: boolean
    elementVolume: number
    elementReadyState: number
    streamActive: boolean
    streamAudioTrackCount: number
    streamAudioTrackState: string
    hasAudioOutput: boolean
  }

  /**
   * Ensure the Room-level AudioContext is resumed (unlocks autoplay).
   * LiveKit SDK handles this internally but we call it explicitly
   * to cover edge cases where browser blocked audio playback.
   *
   * When force is true, bypasses the audioUnlocked flag and checks the actual
   * AudioContext state — needed when Safari suspends audio after initial unlock.
   */
  async function ensureAudioUnlocked(force: boolean = false): Promise<void> {
    if (!force && audioUnlocked) return
    try {
      // Check actual AudioContext state when forcing recovery
      if (force) {
        const ctxState = getAudioContextState()
        if (ctxState.state === 'running') return
        console.log('[WorkbenchExtension] AudioContext not running, forcing startAudio()', { state: ctxState.state })
        audioUnlocked = false
      }
      await lk.startAudio()
      audioUnlocked = true
      console.log('[WorkbenchExtension] Audio context unlocked via startAudio()')
    } catch (err) {
      console.warn('[WorkbenchExtension] startAudio() failed, will retry on user interaction', err)
    }
  }

  /**
   * Try to play an audio element with retry on user interaction.
   */
  function safePlay(element: HTMLAudioElement, trackSid: string): void {
    element.play().catch((err) => {
      console.warn('[WorkbenchExtension] Audio play() failed, will retry on interaction', {
        trackSid,
        errorName: err.name,
        errorMessage: err.message
      })
      // Register one-time click handler to resume playback on user interaction
      const resumeHandler = (): void => {
        void ensureAudioUnlocked().then(() => {
          retryPausedAudioElements()
        })
        document.removeEventListener('click', resumeHandler)
        document.removeEventListener('keydown', resumeHandler)
      }
      document.addEventListener('click', resumeHandler, { once: true })
      document.addEventListener('keydown', resumeHandler, { once: true })
    })
  }

  /**
   * Get current audio context state for debugging Safari audio issues.
   */
  function getAudioContextState(): AudioContextState {
    try {
      // @ts-expect-error - accessing internal LiveKit audio context
      const audioCtx = lk.audioContext
      if (audioCtx != null) {
        return {
          state: audioCtx.state as string,
          sampleRate: audioCtx.sampleRate as number,
          currentTime: audioCtx.currentTime as number
        }
      }
      return { state: 'not_available' }
    } catch (e) {
      return { state: 'error', error: String(e) }
    }
  }

  /**
   * Get current state of all audio elements for debugging.
   */
  function getAudioElementsState(): Array<{
    id: string
    paused: boolean
    muted: boolean
    volume: number
    readyState: number
  }> {
    if (parentElement == null) return []
    const audioElements = Array.from(parentElement.children) as HTMLAudioElement[]
    return audioElements.map((el) => ({
      id: el.id,
      paused: el.paused,
      muted: el.muted,
      volume: el.volume,
      readyState: el.readyState
    }))
  }

  // Audio output monitoring via AnalyserNode on MediaStream (not HTMLAudioElement)
  const audioAnalysers = new Map<string, { analyser: AnalyserNode, source: MediaStreamAudioSourceNode }>()

  /**
   * Monitor actual audio output by attaching an AnalyserNode to the MediaStream.
   * Uses MediaStreamAudioSourceNode (not MediaElementAudioSourceNode) to avoid
   * intercepting the audio element's output pipeline.
   * Returns true if the stream is producing non-silent audio.
   */
  function hasAudioOutput(element: HTMLAudioElement, trackSid: string): boolean {
    let entry = audioAnalysers.get(trackSid)
    if (entry == null) {
      try {
        // @ts-expect-error - accessing internal LiveKit audio context
        const ctx: AudioContext | undefined = lk.audioContext
        if (ctx == null) return true // Cannot check, assume OK
        const stream = element.srcObject as MediaStream | null
        if (stream == null || stream.getAudioTracks().length === 0) return false
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        // Do NOT connect analyser to destination - we only observe, not play
        entry = { analyser, source }
        audioAnalysers.set(trackSid, entry)
      } catch {
        return true // Cannot attach analyser, assume OK
      }
    }
    const data = new Uint8Array(entry.analyser.frequencyBinCount)
    entry.analyser.getByteFrequencyData(data)
    for (let i = 0; i < data.length; i++) {
      if (data[i] > 0) return true
    }
    return false
  }

  function cleanupAnalyser(trackSid: string): void {
    const entry = audioAnalysers.get(trackSid)
    if (entry != null) {
      try {
        entry.source.disconnect()
        entry.analyser.disconnect()
      } catch {}
      audioAnalysers.delete(trackSid)
    }
  }

  /**
   * Collect full diagnostics for all remote audio tracks.
   */
  function collectAudioDiagnostics(): AudioTrackDiagnostics[] {
    const result: AudioTrackDiagnostics[] = []
    for (const participant of lk.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.track?.kind !== Track.Kind.Audio || !publication.isSubscribed) continue
        const mediaTrack = publication.track.mediaStreamTrack
        const element = parentElement?.querySelector<HTMLAudioElement>(`#${CSS.escape(publication.trackSid)}`)
        const stream = element?.srcObject as MediaStream | null
        const streamAudioTrack = stream?.getAudioTracks()[0]
        result.push({
          trackSid: publication.trackSid,
          participantId: participant.identity,
          participantName: participant.name ?? 'unknown',
          isMuted: publication.isMuted,
          mediaTrackReadyState: mediaTrack?.readyState ?? 'no_track',
          mediaTrackEnabled: mediaTrack?.enabled ?? false,
          mediaTrackMuted: mediaTrack?.muted ?? true,
          elementExists: element != null,
          elementPaused: element?.paused ?? true,
          elementVolume: element?.volume ?? 0,
          elementReadyState: element?.readyState ?? 0,
          streamActive: stream?.active ?? false,
          streamAudioTrackCount: stream?.getAudioTracks().length ?? 0,
          streamAudioTrackState: streamAudioTrack?.readyState ?? 'no_stream_track',
          hasAudioOutput: element != null ? hasAudioOutput(element, publication.trackSid) : false
        })
      }
    }
    return result
  }

  /**
   * Retry playing all paused audio elements in the container.
   */
  function retryPausedAudioElements(): void {
    if (parentElement == null) return
    const audioElements = Array.from(parentElement.children) as HTMLAudioElement[]
    for (const el of audioElements) {
      if (el.paused && !el.ended) {
        el.play().catch((err) => {
          console.warn('[WorkbenchExtension] Retry play() still failed', {
            trackSid: el.id,
            error: err.message
          })
        })
      }
    }
  }

  function attachAudioTrack(
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant?: RemoteParticipant
  ): void {
    // Avoid duplicate elements for the same track
    if (parentElement?.querySelector(`#${CSS.escape(publication.trackSid)}`) != null) {
      return
    }

    const element = track.attach() as HTMLAudioElement
    element.id = publication.trackSid
    element.autoplay = true
    parentElement.appendChild(element)

    console.log(
      `[WorkbenchExtension] Audio element attached track=${publication.trackSid} participant=${participant?.identity ?? 'unknown'} children=${parentElement?.children?.length ?? 0}`
    )

    safePlay(element, publication.trackSid)
  }

  function handleTrackSubscribed(
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ): void {
    if (track.kind === Track.Kind.Audio) {
      console.log('[WorkbenchExtension.handleTrackSubscribed] Audio track subscribed', {
        trackSid: publication.trackSid,
        participant: participant.identity,
        participantName: participant.name,
        isMuted: track.isMuted
      })
      void ensureAudioUnlocked()
      attachAudioTrack(track, publication, participant)
    }
  }

  function handleTrackUnsubscribed(
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ): void {
    if (track.kind === Track.Kind.Audio) {
      console.log('[WorkbenchExtension.handleTrackUnsubscribed] Audio track unsubscribed', {
        trackSid: publication.trackSid,
        participant: participant.identity,
        participantName: participant.name
      })
      cleanupAnalyser(publication.trackSid)
      const element = parentElement?.querySelector(`#${CSS.escape(publication.trackSid)}`)
      if (element != null) {
        track.detach(element as HTMLMediaElement)
        element.remove()
      }
    }
  }

  function handleTrackMuted(publication: TrackPublication, participant: Participant): void {
    if (publication.track?.kind !== Track.Kind.Audio) return

    console.log('[WorkbenchExtension.handleTrackMuted]', {
      trackSid: publication.trackSid,
      participant: participant.name,
      isLocal: participant.isLocal
    })
    // Reset silent counter - track is legitimately muted
    silentTrackCounts.delete(publication.trackSid)
  }

  function handleTrackUnmuted(publication: TrackPublication, participant: Participant): void {
    if (publication.track?.kind !== Track.Kind.Audio) return

    console.log('[WorkbenchExtension.handleTrackUnmuted]', {
      trackSid: publication.trackSid,
      participant: participant.name,
      isLocal: participant.isLocal,
      audioCtx: getAudioContextState().state
    })

    if (!participant.isLocal) {
      if (isSafariBrowser) {
        // Safari fix: on unmute, detach and re-attach the audio element
        // to force Safari to re-establish audio routing which it silently drops
        void safariReattachTrack(publication, participant)
      } else {
        // Non-Safari: ensure AudioContext is running and retry paused elements
        void ensureAudioUnlocked(true).then(() => {
          setTimeout(() => {
            const pausedElements = getAudioElementsState().filter((el) => el.paused)
            if (pausedElements.length > 0) {
              console.warn('[WorkbenchExtension.handleTrackUnmuted] Retrying paused elements', {
                ids: pausedElements.map((el) => el.id)
              })
              retryPausedAudioElements()
            }
          }, 100)
        })
      }
    } else if (isSafariBrowser) {
      // Safari bug: local mic mute/unmute can suspend the AudioContext used
      // for remote playback, causing the user to stop hearing everyone.
      // Only act when the context was actually suspended — avoid churning
      // remote audio elements on every local unmute.
      const ctxState = getAudioContextState().state
      if (ctxState !== 'running') {
        void ensureAudioUnlocked(true).then(() => {
          setTimeout(() => {
            const pausedElements = getAudioElementsState().filter((el) => el.paused)
            if (pausedElements.length > 0) {
              console.warn('[WorkbenchExtension.handleTrackUnmuted] Local unmute paused remote audio, reattaching', {
                ids: pausedElements.map((el) => el.id),
                ctxState
              })
              void reattachAllAudioTracks()
            }
          }, 100)
        })
      }
    }
  }

  /**
   * LiveKit signals playback got blocked by the browser (Safari autoplay policy,
   * suspended AudioContext). Canonical recovery point — force unlock and retry.
   */
  function handleAudioPlaybackStatusChanged(): void {
    const canPlayback = lk.canPlaybackAudio
    console.log(
      `[WorkbenchExtension] AudioPlaybackStatusChanged canPlayback=${canPlayback} ctx=${getAudioContextState().state}`
    )
    if (!canPlayback) {
      audioUnlocked = false
      void ensureAudioUnlocked(true).then(() => {
        retryPausedAudioElements()
      })
    }
  }

  /**
   * Safari-specific: detach and re-attach a single audio track
   * to force Safari to re-establish audio routing.
   */
  async function safariReattachTrack(publication: TrackPublication, participant: Participant): Promise<void> {
    await ensureAudioUnlocked(true)

    const track = publication.track
    if (track == null || parentElement == null) return

    cleanupAnalyser(publication.trackSid)

    const existingElement = parentElement.querySelector(`#${CSS.escape(publication.trackSid)}`)
    if (existingElement != null) {
      track.detach(existingElement as HTMLMediaElement)
      existingElement.remove()
    }

    const element = track.attach() as HTMLAudioElement
    element.id = publication.trackSid
    element.autoplay = true
    parentElement.appendChild(element)

    console.log(
      `[WorkbenchExtension.safariReattachTrack] Re-attached track=${publication.trackSid} participant=${participant.name ?? participant.identity}`
    )

    safePlay(element, publication.trackSid)
  }

  /**
   * Re-attach all remote audio tracks. Called after LiveKit reconnect
   * to ensure audio elements reference the new MediaStreams.
   */
  async function reattachAllAudioTracks(): Promise<void> {
    if (parentElement == null) return

    console.log('[WorkbenchExtension] Reattaching audio tracks after reconnect')

    // Resume the AudioContext first — re-attaching elements is useless if the
    // context is suspended or was recreated at a different sampleRate. Await so
    // the detach/attach below runs against a running context.
    await ensureAudioUnlocked(true)

    // Cleanup analysers and detach tracks before removing elements
    for (const participant of lk.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.track?.kind === Track.Kind.Audio && publication.isSubscribed) {
          cleanupAnalyser(publication.trackSid)
          const element = parentElement.querySelector(`#${CSS.escape(publication.trackSid)}`)
          if (element != null) {
            publication.track.detach(element as HTMLMediaElement)
          }
        }
      }
    }

    // Remove stale audio elements
    while (parentElement.firstChild != null) {
      parentElement.removeChild(parentElement.firstChild)
    }

    // Re-attach from current remote participants
    let count = 0
    for (const participant of lk.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.track?.kind === Track.Kind.Audio && publication.isSubscribed) {
          attachAudioTrack(publication.track, publication, participant)
          count++
        }
      }
    }

    console.log('[WorkbenchExtension] Reattached audio tracks', { count })

    await ensureAudioUnlocked()
  }

  /**
   * Periodic audio health check.
   * Detects audio loss by monitoring MediaStreamTrack.readyState,
   * stale srcObject references, and actual audio output via AnalyserNode.
   * Logs diagnostics periodically (throttled) and triggers recovery if needed.
   */
  const AUDIO_CHECK_INTERVAL_MS = 5000
  let lastRecoveryTime = 0
  let lastSampleRate = 0
  const RECOVERY_COOLDOWN_MS = 10000
  let healthCheckCount = 0
  // Log full diagnostics every N checks (every ~30s) to avoid flooding console
  const DIAGNOSTICS_LOG_INTERVAL = 6
  // Count consecutive silent checks per track to avoid false positives
  const silentTrackCounts = new Map<string, number>()
  const SILENT_THRESHOLD = 3 // Trigger recovery after 3 consecutive silent checks (~15s)

  function startSafariAudioHealthCheck(): void {
    if (!isSafariBrowser) return
    stopSafariAudioHealthCheck()

    safariAudioCheckInterval = setInterval(() => {
      if (parentElement == null) return

      healthCheckCount++
      let needsRecovery = false
      const now = Date.now()
      const problems: string[] = []

      // AudioContext-level check: a suspended context or a context recreated at a
      // different sampleRate (Safari does this on mic mute/unmute) silently kills
      // remote playback even though tracks and elements look healthy.
      const ctxState = getAudioContextState()
      if (ctxState.state !== 'running' && ctxState.state !== 'not_available') {
        problems.push(`AudioContext state=${ctxState.state}`)
        needsRecovery = true
      }
      if (ctxState.sampleRate != null) {
        if (lastSampleRate !== 0 && lastSampleRate !== ctxState.sampleRate) {
          problems.push(`AudioContext sampleRate changed ${lastSampleRate} -> ${ctxState.sampleRate}`)
          needsRecovery = true
        }
        lastSampleRate = ctxState.sampleRate
      }

      for (const participant of lk.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) {
          // Audio publication without an active subscription = participant is permanently
          // inaudible; force re-subscribe (autoSubscribe should have handled it)
          if (publication.kind === Track.Kind.Audio && !publication.isSubscribed) {
            problems.push(
              `${participant.identity}/${publication.trackSid}: audio not subscribed, forcing setSubscribed(true)`
            )
            publication.setSubscribed(true)
            continue
          }
          if (publication.track?.kind !== Track.Kind.Audio || !publication.isSubscribed) continue
          if (publication.isMuted) continue

          const mediaTrack = publication.track.mediaStreamTrack
          if (mediaTrack == null) continue
          const trackKey = `${participant.identity}/${publication.trackSid}`

          // Check if the MediaStreamTrack ended unexpectedly
          if (mediaTrack.readyState === 'ended') {
            problems.push(`${trackKey}: MediaStreamTrack ended`)
            needsRecovery = true
            continue
          }

          const element = parentElement.querySelector<HTMLAudioElement>(`#${CSS.escape(publication.trackSid)}`)
          if (element == null) {
            problems.push(`${trackKey}: audio element missing`)
            needsRecovery = true
            continue
          }

          const stream = element.srcObject as MediaStream | null
          if (stream == null || stream.getAudioTracks().length === 0) {
            problems.push(`${trackKey}: no active stream`)
            needsRecovery = true
            continue
          }

          const streamTrack = stream.getAudioTracks()[0]
          if (streamTrack != null && streamTrack.readyState === 'ended') {
            problems.push(`${trackKey}: stream audio track ended`)
            needsRecovery = true
            continue
          }

          // Silence is NOT a reliable signal of broken audio — participants may simply
          // not be speaking. Only treat silence as a problem when it coincides with a
          // real browser-level symptom (MediaStreamTrack.muted flipped by the browser
          // while publication is not muted, or the audio element got paused).
          const browserMuted = mediaTrack.muted && !publication.isMuted
          const elementPaused = element.paused && !element.ended
          if (!hasAudioOutput(element, publication.trackSid) && (browserMuted || elementPaused)) {
            const count = (silentTrackCounts.get(publication.trackSid) ?? 0) + 1
            silentTrackCounts.set(publication.trackSid, count)
            if (count >= SILENT_THRESHOLD) {
              problems.push(`${trackKey}: silent + ${browserMuted ? 'browser-muted' : 'paused'} for ${count} checks`)
              needsRecovery = true
            }
          } else {
            silentTrackCounts.delete(publication.trackSid)
          }
        }
      }

      // Periodic diagnostics log (throttled)
      if (healthCheckCount % DIAGNOSTICS_LOG_INTERVAL === 0) {
        const diag = collectAudioDiagnostics()
        if (diag.length > 0) {
          // Inline JSON so copied Safari console text contains the data (objects paste as "Object")
          console.log(
            `[WorkbenchExtension.healthCheck] Audio diagnostics #${healthCheckCount} ctx=${JSON.stringify(getAudioContextState())} tracks=${JSON.stringify(diag)}`
          )
        }
      }

      if (problems.length > 0) {
        console.warn(`[WorkbenchExtension.healthCheck] Audio problems detected: ${problems.join('; ')}`)
      }

      if (needsRecovery && now - lastRecoveryTime > RECOVERY_COOLDOWN_MS) {
        lastRecoveryTime = now
        silentTrackCounts.clear()
        console.log(
          `[WorkbenchExtension.healthCheck] Triggering audio recovery problems=[${problems.join('; ')}] ctx=${JSON.stringify(getAudioContextState())} diagnostics=${JSON.stringify(collectAudioDiagnostics())}`
        )
        audioUnlocked = false
        void reattachAllAudioTracks()
      }
    }, AUDIO_CHECK_INTERVAL_MS)
  }

  function stopSafariAudioHealthCheck(): void {
    if (safariAudioCheckInterval != null) {
      clearInterval(safariAudioCheckInterval)
      safariAudioCheckInterval = undefined
    }
  }

  /**
   * Attach existing audio tracks from already connected participants.
   */
  function attachExistingAudioTracks(): void {
    let attachedCount = 0
    for (const participant of lk.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.track?.kind === Track.Kind.Audio && publication.isSubscribed) {
          attachAudioTrack(publication.track, publication, participant)
          attachedCount++
        }
      }
    }

    console.log('[WorkbenchExtension.onMount] Attached existing audio tracks', {
      attachedCount,
      totalAudioElements: parentElement?.children?.length ?? 0
    })
  }

  let unsubReconnect: (() => void) | undefined

  onMount(async () => {
    console.log('[WorkbenchExtension.onMount] Mounting WorkbenchExtension', {
      lkState: lk.state,
      remoteParticipantsCount: lk.remoteParticipants.size
    })

    pushRootBarComponent('left', love.component.ControlExt, 20)
    pushRootBarComponent('left', love.component.InvitesExt, 25)
    lk.on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
    lk.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
    lk.on(RoomEvent.TrackMuted, handleTrackMuted)
    lk.on(RoomEvent.TrackUnmuted, handleTrackUnmuted)
    lk.on(RoomEvent.AudioPlaybackStatusChanged, handleAudioPlaybackStatusChanged)

    // Subscribe to incoming meeting invites
    subscribeToIncomingInvites()

    // Attach existing audio tracks
    attachExistingAudioTracks()

    // Only unlock audio when already in a meeting. Calling startAudio() at page
    // load creates a LiveKit AudioContext that steals the iOS audio session and
    // interrupts CarPlay / background music even though no call is active.
    if (get(lkSessionConnected)) {
      void ensureAudioUnlocked()
    }

    // Start Safari audio health check
    startSafariAudioHealthCheck()

    // Listen for reconnect events to re-attach audio elements
    unsubReconnect = lkReconnected.subscribe(() => {
      // Skip initial subscription call (value is 0)
      if (get(lkReconnected) > 0) {
        audioUnlocked = false
        void reattachAllAudioTracks()
      }
    })
  })

  onDestroy(async () => {
    console.log('[WorkbenchExtension.onDestroy] Destroying WorkbenchExtension', {
      lkState: lk.state,
      audioElementsCount: parentElement?.children?.length ?? 0
    })

    lk.off(RoomEvent.TrackSubscribed, handleTrackSubscribed)
    lk.off(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
    lk.off(RoomEvent.TrackMuted, handleTrackMuted)
    lk.off(RoomEvent.TrackUnmuted, handleTrackUnmuted)
    lk.off(RoomEvent.AudioPlaybackStatusChanged, handleAudioPlaybackStatusChanged)
    unsubReconnect?.()
    stopSafariAudioHealthCheck()
    // Cleanup all audio analysers
    for (const trackSid of [...audioAnalysers.keys()]) {
      cleanupAnalyser(trackSid)
    }
    // Unsubscribe from incoming invites
    unsubscribeFromIncomingInvites()
    // Do not disconnect if the current session initiated a connect (user is in the process of connecting)
    // or if the LiveKit client is currently connecting
    if ($lkSessionConnected && $myConnectingSessionId === null && !$lkIsConnecting) {
      console.log('[WorkbenchExtension.onDestroy] Disconnecting LiveKit')
      await liveKitClient.disconnect()
    } else {
      console.log('[WorkbenchExtension.onDestroy] Skipping disconnect', {
        lkSessionConnected: $lkSessionConnected,
        myConnectingSessionId: $myConnectingSessionId,
        lkIsConnecting: $lkIsConnecting
      })
    }
  })
</script>

<div bind:this={parentElement} class="hidden"></div>
