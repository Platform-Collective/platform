<!--
// Copyright © 2026 Intabia Fusion.
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License, this file is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  // Guest join popup:
  // - asks guest for their name
  // - exchanges a guest invite token for a LiveKit token via love service (/guestJoin)
  // - connects to LiveKit and shows minimal video UI with mute/unmute and camera toggle
  // Comments are in English, UI strings are localized via plugin strings.

  import { onMount, onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import { getEmbeddedLabel, getMetadata, IntlString } from '@hcengineering/platform'
  import love from '../../plugin'
  import { liveKitClient, lk } from '../../utils'
  import { lkSessionConnected } from '../../liveKitClient'
  import { closePanel, CheckBox } from '@hcengineering/ui'
  import type { RemoteTrack, RemoteTrackPublication } from 'livekit-client'
  import { RoomEvent } from 'livekit-client'
  import { AuthLikeForm, Label } from '@hcengineering/login-resources'
  import { generateId } from '@hcengineering/core'

  export let meetingId: string | undefined
  export let guestToken: string | undefined
  export let workspaceId: string | undefined
  export let workspaceName: string | undefined

  const identityKey = 'platform.love_uniq_person_identity'

  let firstName: string = ''
  let lastName: string = ''
  let error: string | null = null
  let videoContainer: HTMLDivElement | null = null

  // Local media state
  let micEnabled = true
  let camEnabled = true

  // Start-with options (controls whether we join with video/audio enabled)
  let startWithVideo: boolean = true
  let startWithAudio: boolean = true
  let acceptRecording: boolean = true

  // Local preview state (preview shown before join)
  let localStream: MediaStream | null = null
  let localVideoEl: HTMLVideoElement | null = null
  let previewError: IntlString | null = null
  let previewStarting: boolean = false

  async function startLocalPreview(): Promise<void> {
    if (previewStarting || localStream != null) return
    previewStarting = true
    previewError = null
    try {
      const stream = await navigator.mediaDevices?.getUserMedia({ video: true, audio: false })
      localStream = stream
      if (localVideoEl != null) {
        localVideoEl.srcObject = stream
        localVideoEl.muted = true
        try {
          await localVideoEl.play()
        } catch (e) {
          // Ignore autoplay/play errors
        }
      }
    } catch (err: any) {
      console.error('Failed to start local preview', err)
      // Use localized message for camera permission if available
      previewError = love.string.CamPermission ?? getEmbeddedLabel(err?.message ?? String(err))
    } finally {
      previewStarting = false
    }
  }

  function stopLocalPreview(): void {
    if (localStream != null) {
      for (const t of localStream.getTracks()) {
        try {
          t.stop()
        } catch (e) {
          /* noop */
        }
      }
      localStream = null
    }
    if (localVideoEl != null) {
      localVideoEl.srcObject = null
    }
    previewError = null
    previewStarting = false
  }

  function setStartWithVideo(value: boolean): void {
    startWithVideo = value
    if (get(lkSessionConnected)) {
      void liveKitClient.setCameraEnabled(startWithVideo)
      if (!startWithVideo) stopLocalPreview()
    } else {
      if (startWithVideo) void startLocalPreview()
      else stopLocalPreview()
    }
  }

  function setStartWithAudio(value: boolean): void {
    startWithAudio = value
    if (get(lkSessionConnected)) {
      void liveKitClient.setMicrophoneEnabled(startWithAudio)
    }
  }

  // Attach element for incoming tracks
  function handleTrackSubscribed(track: RemoteTrack, publication: RemoteTrackPublication): void {
    try {
      const el = track.attach()
      if (el == null) return
      // avoid duplicates
      if (videoContainer?.querySelector(`#${publication.trackSid}`) == null) {
        el.id = publication.trackSid
        el.classList.add('guest-track')
        videoContainer?.appendChild(el)
      }
    } catch (err) {
      console.error('Failed to attach track', err)
    }
  }

  function handleTrackUnsubscribed(_track: RemoteTrack, publication: RemoteTrackPublication): void {
    try {
      const el = document.getElementById(publication.trackSid)
      if (el != null && el.parentElement === videoContainer) {
        videoContainer?.removeChild(el)
      }
    } catch (err) {
      console.error('Failed to remove track element', err)
    }
  }

  function attachExistingTracks(): void {
    try {
      // Attach already subscribed remote tracks
      for (const participant of lk.remoteParticipants.values()) {
        for (const pub of participant.trackPublications.values()) {
          if (pub.track != null && pub.isSubscribed) {
            // pub.track may be a local or remote track at compile time; treat as 'any'
            handleTrackSubscribed(pub.track as any, pub)
          }
        }
      }
      // Attach local camera preview if available (from LiveKit)
      for (const pub of lk.localParticipant.trackPublications.values()) {
        if (pub.track != null && pub.track.kind === 'video') {
          const attachable = pub.track as any
          const el = attachable.attach()
          if (el != null && videoContainer?.querySelector(`#${pub.trackSid}`) == null) {
            el.id = pub.trackSid
            el.classList.add('guest-track', 'local-preview')
            videoContainer?.appendChild(el)
          }
        }
      }
    } catch (err) {
      console.error('attachExistingTracks failed', err)
    }
  }

  async function join(firstName: string, lastName: string): Promise<void> {
    if (guestToken == null || meetingId == null) {
      error = 'Missing invite information'
      return
    }
    if (firstName.trim() === '' || lastName.trim() === '') {
      error = 'Please enter your first and last name'
      return
    }
    error = null

    try {
      const endpoint = getMetadata(love.metadata.ServiceEndpoint)
      if (endpoint == null || endpoint === '') {
        throw new Error('Love service endpoint not found')
      }

      let personToken = localStorage.getItem(identityKey)
      if (personToken == null) {
        personToken = generateId()
        localStorage.setItem(identityKey, personToken)
      }

      const resp = await fetch(`${endpoint}/guestJoin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: guestToken,
          firstName,
          lastName,
          personToken
        })
      })

      if (!resp.ok) {
        const txt = await resp.text().catch(() => '')
        throw new Error(`Join failed: ${resp.status} ${txt}`)
      }

      const data = await resp.json()
      const roomToken = data.token as string
      const wsUrl = data.wsUrl as string
      const personRef = data.person as string | undefined

      // Persist guest identity locally (associate by workspaceId or meetingId)
      try {
        const keyId = workspaceId ?? meetingId
        if (keyId != null) {
          const obj = { personRef: personRef ?? null, firstName: firstName.trim(), lastName: lastName.trim() }
          localStorage.setItem('guest:meeting:' + keyId, JSON.stringify(obj))
        }
      } catch (err: any) {
        console.error('Failed to save guest info to localStorage', err)
      }

      // Connect to LiveKit with video allowed based on user's choice
      await liveKitClient.connect(wsUrl, roomToken, startWithVideo)

      // Attach handlers and existing tracks
      lk.on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
      lk.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
      // Attach already present tracks (if participants are already there)
      attachExistingTracks()

      // Stop pre-join preview (LiveKit will publish and attach local track)
      stopLocalPreview()

      // Apply microphone/camera choices
      await liveKitClient.setMicrophoneEnabled(startWithAudio)
      await liveKitClient.setCameraEnabled(startWithVideo)

      // Set local indicators
      micEnabled = startWithAudio
      camEnabled = startWithVideo

      // Close panel (hide pre-join panel after successful join)
      closePanel()
    } catch (err: any) {
      console.error('Guest join failed', err)
      error = err?.message ?? String(err)
    }
  }

  async function toggleMute(): Promise<void> {
    try {
      await liveKitClient.setMicrophoneEnabled(!micEnabled)
      micEnabled = !micEnabled
    } catch (err) {
      console.error('Failed to toggle microphone', err)
    }
  }

  async function toggleCam(): Promise<void> {
    try {
      await liveKitClient.setCameraEnabled(!camEnabled)
      camEnabled = !camEnabled
    } catch (err) {
      console.error('Failed to toggle camera', err)
    }
  }

  async function leave(): Promise<void> {
    try {
      await liveKitClient.disconnect()
    } catch (err) {
      console.error('Failed to disconnect', err)
    } finally {
      // Close popup/panel
      closePanel()
    }
  }

  onMount(() => {
    // If someone opened this popup already connected, attach tracks
    if ($lkSessionConnected) {
      lk.on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
      lk.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
      attachExistingTracks()
    }

    // Prefill name from localStorage (per-workspace or per-meeting)
    try {
      const keyId = workspaceId ?? meetingId
      if (keyId != null) {
        const saved = localStorage.getItem('guest:meeting:' + keyId)
        if (saved != null && saved !== '') {
          const parsed = JSON.parse(saved)
          firstName = parsed.firstName ?? firstName
          lastName = parsed.lastName ?? lastName
        }
      }
    } catch (err) {
      console.error('Failed to load guest info from storage', err)
    }

    // Start local preview automatically if user chose video and not already connected
    if (startWithVideo && !$lkSessionConnected) {
      void startLocalPreview()
    }
  })

  onDestroy(() => {
    try {
      lk.off(RoomEvent.TrackSubscribed, handleTrackSubscribed)
      lk.off(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
    } catch (e) {
      // noop
    } finally {
      // Ensure pre-join preview is stopped and tracks cleaned up
      stopLocalPreview()
    }
  })
</script>

{#if !$lkSessionConnected}
  <AuthLikeForm
    caption={undefined}
    handleProceed={async (f, l) => {
      firstName = f ?? ''
      lastName = l ?? ''
      await join(firstName, lastName)
    }}
    {firstName}
    {lastName}
    proceedDisabled={!acceptRecording}
    proceedButton={love.string.JoinMeeting}
  >
    <svelte:fragment slot="before-form">
      <div class="actions center">
        <div class="form" role="dialog" aria-label={love.string.GuestJoin}>
          {#if error != null || previewError != null}
            <div class="error">
              {#if error != null}
                {error}
              {/if}
              {#if previewError}
                <Label label={previewError} />
              {/if}
            </div>
          {/if}
          <div class="preview-area" aria-hidden={startWithVideo ? 'false' : 'true'}>
            <div class="preview">
              <video bind:this={localVideoEl} autoplay muted playsinline class="preview-video" />
            </div>
          </div>

          <div class="checks" role="group" aria-label={love.string.StartOptions}>
            <div class="check-item">
              <CheckBox
                checked={startWithVideo}
                size="small"
                kind="primary"
                on:value={(e) => {
                  setStartWithVideo(e.detail)
                }}
              />
              <button
                type="button"
                class="check-label"
                on:click={() => {
                  setStartWithVideo(!startWithVideo)
                }}
                aria-pressed={startWithVideo}
              >
                <Label label={love.string.StartWithVideo} />
              </button>
            </div>
            <div class="check-item">
              <CheckBox
                checked={startWithAudio}
                size="small"
                kind="primary"
                on:value={(e) => {
                  setStartWithAudio(e.detail)
                }}
              />
              <button
                type="button"
                class="check-label"
                on:click={() => {
                  setStartWithAudio(!startWithAudio)
                }}
                aria-pressed={startWithAudio}
              >
                <Label label={love.string.StartWithAudio} />
              </button>
            </div>
          </div>
          <div class="checks" role="group">
            <div class="check-item">
              <CheckBox
                checked={acceptRecording}
                size="small"
                kind="primary"
                on:value={(e) => {
                  acceptRecording = e.detail
                }}
              />
              <button
                type="button"
                class="check-label"
                on:click={() => {
                  acceptRecording = !acceptRecording
                }}
                aria-pressed={acceptRecording}
              >
                <Label label={love.string.AcceptRecording} wrap />
              </button>
            </div>
          </div>
        </div>
      </div>
    </svelte:fragment>
  </AuthLikeForm>
{/if}
<div class="guest-join">
  {#if $lkSessionConnected}
    <div>
      <div class="controls">
        <button on:click={toggleMute}>{micEnabled ? love.string.Mute : love.string.UnMute}</button>
        <button on:click={toggleCam}>{camEnabled ? love.string.StopVideo : love.string.StartVideo}</button>
        <button class="secondary" on:click={leave}>{love.string.LeaveRoom}</button>
      </div>
      <div class="video-grid" bind:this={videoContainer} aria-live="polite" />
    </div>
  {/if}
</div>

<style>
  .guest-join {
    padding: 12px;
    min-width: 320px;
    /*max-width: 720px;*/
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
  }

  .preview-area {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    justify-content: center;
    max-width: 300px;
  }

  .preview-caption {
    color: var(--theme-caption-color, #666);
    font-size: 0.9rem;
  }

  .preview {
    width: 100%;
    max-width: 360px;
    height: 200px;
    background: black;
    border-radius: 6px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .preview-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    background: black;
  }

  input[type='text'] {
    padding: 8px;
    font-size: 1rem;
    border: 1px solid var(--border-color, #ccc);
    border-radius: 4px;
  }

  .checks {
    display: flex;
    gap: 16px;
    justify-content: space-between;
    align-items: center;
    width: 300px;
  }
  .check-item {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    cursor: pointer;
    user-select: none;
    gap: 0.5rem;
    font-size: 0.95rem;
    color: var(--login-content-color, var(--theme-content-color));
  }

  /* Using UI CheckBox component's built-in styling; custom .check-box rules removed */

  .check-label {
    background: var(--login-primary-button-default, var(--primary-button-default, #cf13a2));
    color: var(--login-content-color, var(--theme-content-color));
    border-color: var(--login-primary-button-default, var(--primary-button-default));
    font-size: 0.95rem;
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
  }

  .input-wrapper {
    width: 100%;
    max-width: 520px;
  }

  .actions {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }

  .actions.center {
    justify-content: center;
  }

  button {
    padding: 8px 12px;
    border-radius: 6px;
    border: none;
    background: var(--primary, #2d8cf0);
    color: white;
    cursor: pointer;
  }

  button.secondary {
    background: #f0f0f0;
    color: #333;
  }

  .error {
    color: var(--color-danger, #c0392b);
    font-size: 0.9rem;
    margin-top: 6px;
  }

  .controls {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 8px;
  }

  .video-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 8px;
    width: 100%;
    margin-top: 8px;
  }

  .video-grid video {
    width: 100%;
    height: auto;
    background: black;
    border-radius: 4px;
    display: block;
  }

  .local-preview {
    outline: 2px solid rgba(0, 0, 0, 0.2);
  }
</style>
